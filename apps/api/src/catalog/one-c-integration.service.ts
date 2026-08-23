import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { z } from "zod";

import type { AuthContext } from "../auth/auth-context.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { AuditService } from "../security/audit.service.js";
import { PasswordService } from "../security/password.service.js";
import { RateLimitService } from "../security/rate-limit.service.js";
import { parseBasicAuthorization, safeTextEqual } from "./catalog-import.utils.js";

const UpdateOneCSettingsSchema = z.object({
  allowedNetworks: z.array(
    z.string().trim().min(3).max(64).regex(/^[0-9A-Fa-f:.]+\/\d{1,3}$/u),
  ).max(64).optional(),
  enabled: z.boolean().optional(),
  password: z.string().min(16).max(256).optional(),
  username: z.string().trim().min(3).max(120).optional(),
}).strict();

const RequestLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  succeeded: z.enum(["true", "false"]).optional(),
});

interface OneCSettingsRow {
  allowed_networks: string[];
  is_enabled: boolean;
  last_exchange_at: Date | null;
  last_exchange_summary: Record<string, unknown>;
  secret_hash: Buffer | null;
  updated_at: Date;
  username: string | null;
}

// Written by OneCExchangeService once a chunked CommerceML run reaches
// 'completed' (see app.one_c_exchange_runs / migration 0016) — kept as a
// small denormalised summary on the settings row itself so the admin panel
// can show "last exchange result" without a join or a second round trip.
export interface OneCExchangeSummary {
  containsOnlyChanges: boolean;
  filename: string;
  kind: "catalog" | "offers";
  rowsRejected: number;
  rowsTouched: number;
  /** How many products this run filed under the explicit "Без категории" bucket instead of a real category -- see catalog-known-categories.ts. Always 0 for an "offers" run (price/stock only, no category assignment happens there). */
  rowsUncategorized: number;
}

export interface IntegrationRequestEvent {
  batchId?: string;
  details?: Record<string, unknown>;
  durationMs?: number;
  externalRequestId?: string;
  ipAddress?: string;
  operation: string;
  payloadChecksum?: Buffer;
  statusCode: number;
  succeeded: boolean;
}

@Injectable()
export class OneCIntegrationService {
  constructor(
    private readonly audit: AuditService,
    private readonly database: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async getSettings(): Promise<Record<string, unknown>> {
    const row = await this.loadSettings();
    return this.safeSettings(row);
  }

  async updateSettings(
    rawInput: unknown,
    actor: AuthContext,
    ipAddress: string,
    userAgent?: string,
  ): Promise<Record<string, unknown>> {
    const parsedInput = UpdateOneCSettingsSchema.safeParse(rawInput);
    if (!parsedInput.success) throw new BadRequestException("Некорректные настройки интеграции 1С");
    const input = parsedInput.data;
    return this.database.transaction(async (client) => {
      const existing = await client.query<OneCSettingsRow>(
        `SELECT is_enabled, username, secret_hash, allowed_networks::text[], updated_at,
                last_exchange_at, last_exchange_summary
         FROM app.integration_endpoints
         WHERE integration_key = 'one_c'
         FOR UPDATE`,
      );
      const before = existing.rows[0];
      const username = input.username ?? before?.username ?? null;
      // Hashed, not encrypted: this only ever needs to be *verified* against
      // whatever 1C sends on the next request, never read back, so there is
      // no reason to keep it reversible (see migration 0017).
      const secret = input.password
        ? Buffer.from(await this.passwords.hash(input.password), "utf8")
        : before?.secret_hash ?? null;
      const allowedNetworks = input.allowedNetworks ?? before?.allowed_networks ?? [];
      const enabled = input.enabled ?? before?.is_enabled ?? false;

      if (enabled && (!username || !secret || allowedNetworks.length === 0)) {
        throw new BadRequestException(
          "Для включения 1С нужны username, сохранённый или новый пароль и непустой IP allowlist",
        );
      }
      try {
        await client.query("SELECT $1::text[]::cidr[]", [allowedNetworks]);
      } catch {
        throw new BadRequestException("IP allowlist содержит некорректную CIDR-сеть");
      }

      const updated = await client.query<OneCSettingsRow>(
        `
          INSERT INTO app.integration_endpoints (
            integration_key, is_enabled, username, secret_hash, allowed_networks
          ) VALUES ('one_c', $1, $2, $3, $4::cidr[])
          ON CONFLICT (integration_key) DO UPDATE
          SET is_enabled = EXCLUDED.is_enabled,
              username = EXCLUDED.username,
              secret_hash = EXCLUDED.secret_hash,
              allowed_networks = EXCLUDED.allowed_networks,
              updated_at = clock_timestamp()
          RETURNING is_enabled, username, secret_hash, allowed_networks::text[], updated_at,
                    last_exchange_at, last_exchange_summary
        `,
        [enabled, username, secret, allowedNetworks],
      );
      const after = updated.rows[0];
      if (!after) throw new Error("1C settings update returned no row");
      await this.audit.record({
        action: "integration.one_c.settings_updated",
        actorRole: actor.role,
        actorUserId: actor.userId,
        afterState: this.safeSettings(after),
        beforeState: this.safeSettings(before),
        entityId: "one_c",
        entityType: "integration_endpoint",
        ipAddress,
        metadata: { passwordRotated: Boolean(input.password) },
        userAgent,
      }, client);
      return this.safeSettings(after);
    });
  }

  async authorize(authorization: string | undefined, ipAddress: string): Promise<void> {
    try {
      await this.rateLimit.consume("one-c-ip", ipAddress, 60, 60);
    } catch (error) {
      await this.recordRequest({
        details: { outcome: "rate_limited" },
        ipAddress,
        operation: "authenticate",
        statusCode: 429,
        succeeded: false,
      });
      throw error;
    }

    const accepted = await this.checkCredentials(authorization, ipAddress);
    if (!accepted) {
      await this.recordRequest({
        details: { outcome: "rejected" },
        ipAddress,
        operation: "authenticate",
        statusCode: 401,
        succeeded: false,
      });
      throw new UnauthorizedException("Интеграция 1С недоступна");
    }

    await this.database.query(
      "UPDATE app.integration_endpoints SET last_used_at = clock_timestamp() WHERE integration_key = 'one_c'",
    );
  }

  /**
   * Same credential + CIDR check as {@link authorize}, but for the
   * one-c-exchange CommerceML handshake (one-c-exchange.controller.ts):
   * mode=checkauth owns its own plain-text reply and request-log entry (a
   * "success\n<cookie>\n<value>" body has nothing in common with the JSON
   * machine endpoint's exception-driven response), so it needs a boolean
   * rather than a throw. Both transports authenticate against the same
   * integration_key='one_c' row -- one shop, one 1C integration, two wire
   * protocols.
   */
  async verifyBasicAuth(authorization: string | undefined, ipAddress: string): Promise<boolean> {
    const accepted = await this.checkCredentials(authorization, ipAddress);
    if (accepted) {
      await this.database.query(
        "UPDATE app.integration_endpoints SET last_used_at = clock_timestamp() WHERE integration_key = 'one_c'",
      );
    }
    return accepted;
  }

  /** Denormalised onto the settings row by migration 0016 so the admin panel can show it without a second table -- see OneCExchangeSummary. */
  async recordExchangeResult(summary: OneCExchangeSummary): Promise<void> {
    await this.database.query(
      `UPDATE app.integration_endpoints
       SET last_exchange_at = clock_timestamp(), last_exchange_summary = $1::jsonb
       WHERE integration_key = 'one_c'`,
      [JSON.stringify(summary)],
    );
  }

  private async checkCredentials(authorization: string | undefined, ipAddress: string): Promise<boolean> {
    const credentials = parseBasicAuthorization(authorization);
    const result = await this.database.query<OneCSettingsRow & { ip_allowed: boolean }>(
      `
        SELECT is_enabled, username, secret_hash, allowed_networks::text[], updated_at,
               last_exchange_at, last_exchange_summary,
               COALESCE($1::inet <<= ANY(allowed_networks), false) AS ip_allowed
        FROM app.integration_endpoints
        WHERE integration_key = 'one_c'
      `,
      [ipAddress],
    );
    const settings = result.rows[0];
    // PasswordService.verify() always runs an argon2 pass -- even a null
    // hash falls back to its own dummy hash -- so a disabled integration or
    // an unknown IP takes the same time to reject as a wrong password. Doing
    // the lookup unconditionally (rather than short-circuiting on
    // settings/ip_allowed first) is what keeps that guarantee.
    const passwordMatches = await this.passwords.verify(
      credentials?.password ?? "",
      settings?.secret_hash?.toString("utf8"),
    );
    const usernameMatches = Boolean(
      credentials && settings?.username && safeTextEqual(credentials.username, settings.username),
    );
    return Boolean(credentials && settings?.is_enabled && settings.ip_allowed && usernameMatches && passwordMatches);
  }

  async listRequests(rawQuery: unknown): Promise<Record<string, unknown>> {
    const parsed = RequestLogQuerySchema.safeParse(rawQuery);
    if (!parsed.success) throw new BadRequestException("Некорректные параметры журнала");
    const query = parsed.data;
    const succeeded = query.succeeded === undefined ? null : query.succeeded === "true";
    const rows = await this.database.query<{
      batch_id: string | null;
      created_at: Date;
      details: Record<string, unknown>;
      duration_ms: number | null;
      external_request_id: string | null;
      id: string;
      ip_address: string | null;
      operation: string;
      status_code: number;
      succeeded: boolean;
    }>(
      `SELECT id::text, operation, external_request_id, ip_address::text, succeeded,
              status_code, batch_id, duration_ms, details, created_at
       FROM app.integration_request_log
       WHERE integration_key = 'one_c' AND ($1::boolean IS NULL OR succeeded = $1)
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [succeeded, query.limit, query.offset],
    );
    const count = await this.database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM app.integration_request_log
       WHERE integration_key = 'one_c' AND ($1::boolean IS NULL OR succeeded = $1)`,
      [succeeded],
    );
    return {
      items: rows.rows.map((row) => ({
        batchId: row.batch_id,
        createdAt: row.created_at.toISOString(),
        details: row.details,
        durationMs: row.duration_ms,
        externalRequestId: row.external_request_id,
        id: row.id,
        ipAddress: row.ip_address,
        operation: row.operation,
        statusCode: row.status_code,
        succeeded: row.succeeded,
      })),
      limit: query.limit,
      offset: query.offset,
      total: Number(count.rows[0]?.count ?? 0),
    };
  }

  async recordRequest(event: IntegrationRequestEvent): Promise<void> {
    await this.database.query(
      `
        INSERT INTO app.integration_request_log (
          integration_key, operation, external_request_id, ip_address, succeeded,
          status_code, batch_id, payload_checksum, duration_ms, details
        ) VALUES ('one_c', $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      `,
      [
        event.operation,
        event.externalRequestId ?? null,
        event.ipAddress ?? null,
        event.succeeded,
        event.statusCode,
        event.batchId ?? null,
        event.payloadChecksum ?? null,
        event.durationMs ?? null,
        JSON.stringify(event.details ?? {}),
      ],
    );
  }

  private async loadSettings(): Promise<OneCSettingsRow | undefined> {
    return (await this.database.query<OneCSettingsRow>(
      `SELECT is_enabled, username, secret_hash, allowed_networks::text[], updated_at,
              last_exchange_at, last_exchange_summary
       FROM app.integration_endpoints WHERE integration_key = 'one_c'`,
    )).rows[0];
  }

  private safeSettings(row: OneCSettingsRow | undefined): Record<string, unknown> {
    return {
      allowedNetworks: row?.allowed_networks ?? [],
      enabled: row?.is_enabled ?? false,
      hasPassword: Boolean(row?.secret_hash),
      lastExchangeAt: row?.last_exchange_at?.toISOString() ?? null,
      lastExchangeSummary: row?.last_exchange_summary ?? {},
      updatedAt: row?.updated_at?.toISOString() ?? null,
      username: row?.username ?? null,
    };
  }
}
