import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";

import { DatabaseService, type DatabaseExecutor } from "../infrastructure/database.service.js";
import { RedisService } from "../infrastructure/redis.service.js";
import { AuditService } from "../security/audit.service.js";
import { CryptoService } from "../security/crypto.service.js";
import { PasswordService } from "../security/password.service.js";
import type { AuthContext } from "./auth-context.js";
import { SessionService } from "./session.service.js";
import { buildSocialAuthorizationUrl, resolveSocialSubject, socialProviders, type SocialProvider } from "./social-provider.js";

export const SOCIAL_FLOW_SECONDS = 600;
const nonce = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const flowSchema = z.object({ verifier: nonce, sessionId: z.uuid().nullable() });
const callbackSchema = z.object({
  state: nonce,
  code: z.string().min(1).max(2_048).optional(),
  device_id: z.string().min(1).max(256).optional(),
  error: z.string().max(300).optional(),
});

interface RequestMetadata {
  ipAddress: string;
  userAgent?: string;
}

const eligibleCustomer = `account.status = 'active'
  AND account.email_verified_at IS NOT NULL AND account.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM app.staff_members AS staff WHERE staff.user_id = account.id)`;

@Injectable()
export class SocialAuthService {
  private readonly appOrigin: string;
  private readonly clientIds: Partial<Record<SocialProvider, string>>;

  constructor(
    config: ConfigService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly database: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly redis: RedisService,
    private readonly sessions: SessionService,
  ) {
    this.appOrigin = new URL(config.getOrThrow<string>("APP_ORIGIN")).origin;
    this.clientIds = config.getOrThrow<boolean>("LEGAL_DOCUMENTS_APPROVED") ? {
      yandex: config.get<string>("YANDEX_ID_CLIENT_ID"),
      vk: config.get<string>("VK_ID_CLIENT_ID"),
    } : {};
  }

  providers() {
    return socialProviders.filter(provider => this.clientIds[provider]);
  }

  async connections(auth: AuthContext) {
    this.assertCustomer(auth);
    const result = await this.database.query<{ provider: SocialProvider }>(
      "SELECT provider FROM app.customer_social_identities WHERE user_id = $1",
      [auth.userId],
    );
    return { enabled: this.providers(), linked: result.rows.map(row => row.provider) };
  }

  async begin(provider: SocialProvider, auth?: AuthContext) {
    const clientId = this.clientIds[provider];
    if (!clientId) throw new NotFoundException("Способ входа недоступен");
    const state = this.crypto.randomToken();
    const verifier = this.crypto.randomToken();
    const browserToken = this.crypto.randomToken();
    await this.redis.ensureConnected();
    await this.redis.client.set(this.flowKey(provider, state, browserToken), JSON.stringify({
      verifier,
      sessionId: auth?.sessionId ?? null,
    }), "EX", SOCIAL_FLOW_SECONDS);
    return {
      authorizationUrl: buildSocialAuthorizationUrl(provider, clientId, this.redirectUri(provider), state, verifier),
      browserToken,
    };
  }

  async complete(provider: SocialProvider, query: unknown, browserToken: string | undefined, currentAuth: AuthContext | null, metadata: RequestMetadata) {
    const data = callbackSchema.safeParse(query);
    const clientId = this.clientIds[provider];
    if (!data.success || !nonce.safeParse(browserToken).success || !browserToken || !clientId) return { kind: "failed" } as const;
    await this.redis.ensureConnected();
    const stored = await this.redis.client.getdel(this.flowKey(provider, data.data.state, browserToken));
    if (!stored) return { kind: "failed" } as const;
    const flow = flowSchema.parse(JSON.parse(stored));
    if (flow.sessionId !== (currentAuth?.sessionId ?? null) || (currentAuth && currentAuth.role !== "customer")) {
      return { kind: "failed" } as const;
    }
    const { code, device_id: deviceId, error, state } = data.data;
    if (error || !code) return { kind: currentAuth ? "link-failed" : "cancelled" } as const;
    let subject: string;
    try {
      subject = await resolveSocialSubject({
        provider, clientId, code, deviceId, state, redirectUri: this.redirectUri(provider), verifier: flow.verifier,
      });
    } catch {
      return { kind: currentAuth ? "link-failed" : "failed" } as const;
    }

    if (currentAuth) {
      const linked = await this.link(provider, subject, currentAuth, metadata);
      return { kind: linked ? "linked" : "link-conflict" } as const;
    }
    const session = await this.login(provider, subject, metadata);
    return session ? { kind: "logged-in", session } as const : { kind: "unlinked" } as const;
  }

  async confirmPassword(auth: AuthContext, password: string) {
    this.assertCustomer(auth);
    const result = await this.database.query<{ password_hash: string | null }>(
      `SELECT account.password_hash FROM app.users AS account
       WHERE account.id = $1 AND ${eligibleCustomer}
         AND (account.locked_until IS NULL OR account.locked_until <= clock_timestamp())`,
      [auth.userId],
    );
    const hash = result.rows[0]?.password_hash;
    const verified = await this.passwords.verify(password, hash);
    if (!hash || !verified) throw new UnauthorizedException("Текущий пароль не подошёл");
  }

  async disconnect(provider: SocialProvider, auth: AuthContext, metadata: RequestMetadata) {
    this.assertCustomer(auth);
    await this.database.transaction(async client => {
      const deleted = await client.query(
        "DELETE FROM app.customer_social_identities WHERE user_id = $1 AND provider = $2",
        [auth.userId, provider],
      );
      if (deleted.rowCount) await this.record("unlinked", provider, auth.userId, metadata, client);
    });
  }

  private async link(provider: SocialProvider, subject: string, auth: AuthContext, metadata: RequestMetadata) {
    return this.database.transaction(async client => {
      const active = await client.query(
        `SELECT 1 FROM app.users AS account WHERE account.id = $1 AND ${eligibleCustomer} FOR UPDATE`,
        [auth.userId],
      );
      if (!active.rowCount) return false;
      const link = await client.query(
        `INSERT INTO app.customer_social_identities (user_id, provider, subject)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING RETURNING user_id`,
        [auth.userId, provider, subject],
      );
      if (link.rowCount) {
        await this.record("linked", provider, auth.userId, metadata, client);
        return true;
      }
      const existing = await client.query(
        "SELECT 1 FROM app.customer_social_identities WHERE user_id = $1 AND provider = $2 AND subject = $3",
        [auth.userId, provider, subject],
      );
      return Boolean(existing.rowCount);
    });
  }

  private async login(provider: SocialProvider, subject: string, metadata: RequestMetadata) {
    return this.database.transaction(async client => {
      const result = await client.query<{ id: string }>(
        `SELECT account.id FROM app.users AS account
         JOIN app.customer_social_identities AS identity ON identity.user_id = account.id
         WHERE identity.provider = $1 AND identity.subject = $2 AND ${eligibleCustomer}
           AND (account.locked_until IS NULL OR account.locked_until <= clock_timestamp())
         FOR UPDATE OF account, identity`,
        [provider, subject],
      );
      const userId = result.rows[0]?.id;
      if (!userId) return null;
      await client.query("UPDATE app.users SET last_login_at = clock_timestamp() WHERE id = $1", [userId]);
      const session = await this.sessions.create(userId, metadata.ipAddress, metadata.userAgent, false, client);
      await this.record("login", provider, userId, metadata, client);
      return session;
    });
  }

  private record(event: "linked" | "unlinked" | "login", provider: SocialProvider, userId: string, metadata: RequestMetadata, client: DatabaseExecutor) {
    return this.audit.record({
      action: `auth.social.${event}`,
      actorUserId: userId,
      entityId: userId,
      entityType: "user",
      metadata: { provider },
      ...metadata,
    }, client);
  }

  private assertCustomer(auth: AuthContext) {
    if (auth.role !== "customer") throw new ForbiddenException("Доступно только покупателям");
  }

  private redirectUri(provider: SocialProvider) {
    return `${this.appOrigin}/api/v1/auth/social/${provider}/callback`;
  }

  private flowKey(provider: SocialProvider, state: string, browserToken: string) {
    return `an30:auth:social:${this.crypto.opaqueHash("social-flow", `${provider}:${state}:${browserToken}`).toString("hex")}`;
  }
}
