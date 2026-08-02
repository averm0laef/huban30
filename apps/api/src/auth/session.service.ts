import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { FastifyReply } from "fastify";
import type { PoolClient } from "pg";

import { RoleSchema, type Role } from "@an30/contracts";

import { DatabaseService, type DatabaseExecutor } from "../infrastructure/database.service.js";
import { CryptoService } from "../security/crypto.service.js";
import type { AuthContext } from "./auth-context.js";

export const SESSION_COOKIE_NAME = "an30_session";
export const CSRF_COOKIE_NAME = "an30_csrf";

interface SessionRow {
  csrf_token_hash: Buffer;
  email: string;
  mfa_verified_at: Date | null;
  role: string | null;
  session_id: string;
  staff_status: string | null;
  totp_confirmed_at: Date | null;
  user_id: string;
  user_status: string;
}

export interface CreatedSession {
  csrfToken: string;
  expiresAt: Date;
  sessionId: string;
  token: string;
}

@Injectable()
export class SessionService {
  private readonly cookieSecure: boolean;
  private readonly idleMinutes: number;
  private readonly ttlHours: number;

  constructor(
    config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly database: DatabaseService,
  ) {
    this.cookieSecure = config.getOrThrow<boolean>("COOKIE_SECURE");
    this.idleMinutes = config.getOrThrow<number>("SESSION_IDLE_MINUTES");
    this.ttlHours = config.getOrThrow<number>("SESSION_TTL_HOURS");
  }

  async create(
    userId: string,
    ipAddress: string,
    userAgent: string | undefined,
    mfaVerified: boolean,
    executor: DatabaseExecutor = this.database,
    rotatedFromId?: string,
  ): Promise<CreatedSession> {
    const token = this.crypto.randomToken();
    const csrfToken = this.crypto.randomToken();
    const expiresAt = new Date(Date.now() + this.ttlHours * 60 * 60 * 1_000);
    const idleExpiresAt = new Date(Math.min(
      expiresAt.getTime(),
      Date.now() + this.idleMinutes * 60 * 1_000,
    ));
    const result = await executor.query<{ id: string }>(
      `
        INSERT INTO app.auth_sessions (
          user_id, session_hash, csrf_token_hash, rotated_from_id, ip_address,
          user_agent, expires_at, idle_expires_at, mfa_verified_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
          CASE WHEN $9::boolean THEN clock_timestamp() ELSE NULL END)
        RETURNING id
      `,
      [
        userId,
        this.crypto.opaqueHash("session", token),
        this.crypto.opaqueHash("csrf", csrfToken),
        rotatedFromId ?? null,
        ipAddress,
        userAgent?.slice(0, 1_000) ?? null,
        expiresAt,
        idleExpiresAt,
        mfaVerified,
      ],
    );
    const sessionId = result.rows[0]?.id;
    if (!sessionId) throw new Error("Session creation did not return an identifier");
    return { csrfToken, expiresAt, sessionId, token };
  }

  async resolve(token: string, touch = true): Promise<AuthContext | null> {
    const result = await this.database.query<SessionRow>(
      `
        SELECT
          session.id AS session_id,
          session.user_id,
          session.csrf_token_hash,
          session.mfa_verified_at,
          account.email::text,
          account.status::text AS user_status,
          staff.role::text,
          staff.status::text AS staff_status,
          staff.totp_confirmed_at
        FROM app.auth_sessions AS session
        JOIN app.users AS account ON account.id = session.user_id
        LEFT JOIN app.staff_members AS staff ON staff.user_id = account.id
        WHERE session.session_hash = $1
          AND session.revoked_at IS NULL
          AND session.expires_at > clock_timestamp()
          AND session.idle_expires_at > clock_timestamp()
          AND account.deleted_at IS NULL
          AND (
            account.session_invalid_before IS NULL
            OR session.created_at >= account.session_invalid_before
          )
        LIMIT 1
      `,
      [this.crypto.opaqueHash("session", token)],
    );
    const row = result.rows[0];
    if (!row || row.user_status !== "active") return null;
    if (row.role && row.staff_status !== "active") return null;

    const role: Role = row.role ? RoleSchema.parse(row.role) : "customer";
    if (touch) {
      await this.database.query(
        `UPDATE app.auth_sessions
         SET last_seen_at=clock_timestamp(),
             idle_expires_at=LEAST(
               expires_at,clock_timestamp()+make_interval(mins => $2)
             )
         WHERE id=$1`,
        [row.session_id, this.idleMinutes],
      );
    }

    return {
      csrfTokenHash: row.csrf_token_hash,
      email: row.email,
      mfaSetupRequired: role !== "customer" && row.totp_confirmed_at === null,
      mfaVerified: role === "customer" || row.mfa_verified_at !== null,
      role,
      sessionId: row.session_id,
      userId: row.user_id,
    };
  }

  csrfMatches(token: string, expected: Buffer): boolean {
    return this.crypto.opaqueHashMatches("csrf", token, expected);
  }

  async rotateWithMfa(
    sessionId: string,
    ipAddress: string,
    userAgent: string | undefined,
    executor?: PoolClient,
  ): Promise<CreatedSession> {
    const rotate = async (client: PoolClient): Promise<CreatedSession> => {
      const selected = await client.query<{ user_id: string }>(
        `
          SELECT user_id
          FROM app.auth_sessions
          WHERE id = $1 AND revoked_at IS NULL
          FOR UPDATE
        `,
        [sessionId],
      );
      const userId = selected.rows[0]?.user_id;
      if (!userId) throw new Error("Active session was not found for rotation");
      await client.query(
        `
          UPDATE app.auth_sessions
          SET revoked_at = clock_timestamp(), revoke_reason = 'rotated_after_mfa'
          WHERE id = $1
        `,
        [sessionId],
      );
      return this.create(userId, ipAddress, userAgent, true, client, sessionId);
    };
    return executor ? rotate(executor) : this.database.transaction(rotate);
  }

  async revoke(sessionId: string, reason = "logout"): Promise<void> {
    await this.database.query(
      `
        UPDATE app.auth_sessions
        SET revoked_at = COALESCE(revoked_at, clock_timestamp()), revoke_reason = COALESCE(revoke_reason, $2)
        WHERE id = $1
      `,
      [sessionId, reason],
    );
  }

  setCookie(reply: FastifyReply, session: CreatedSession): void {
    reply.setCookie(SESSION_COOKIE_NAME, session.token, {
      expires: session.expiresAt,
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: this.cookieSecure,
    });
    reply.setCookie(CSRF_COOKIE_NAME, session.csrfToken, {
      expires: session.expiresAt,
      httpOnly: false,
      path: "/",
      sameSite: "strict",
      secure: this.cookieSecure,
    });
  }

  clearCookie(reply: FastifyReply): void {
    reply.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: this.cookieSecure,
    });
    reply.clearCookie(CSRF_COOKIE_NAME, {
      httpOnly: false,
      path: "/",
      sameSite: "strict",
      secure: this.cookieSecure,
    });
  }
}
