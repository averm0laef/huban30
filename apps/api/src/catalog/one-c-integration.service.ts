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
import { namedOneCExchangeOptions, ONE_C_DEFAULT_EXPECTED_SYNC_MINUTES, readOneCExchangeOptions } from "../one-c-exchange/one-c-exchange-options.js";
import { ONE_C_SOURCES, sourceSql, type OneCSource } from "../one-c-exchange/one-c-source.js";

const UpdateOneCSettingsSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  expectedSyncMinutes: z.number().int().min(5).max(10080).optional(),
  allowedNetworks: z.array(
    z.string().trim().min(3).max(64).regex(/^[0-9A-Fa-f:.]+\/\d{1,3}$/u),
  ).max(64).optional(),
  enabled: z.boolean().optional(),
  password: z.string().min(16).max(256).optional(),
  // Exchange switches of this base (one-c-exchange-options.ts).
  publishDescriptions: z.boolean().optional(),
  username: z.string().trim().min(3).max(120).optional(),
}).strict();

const ExchangeRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

const RequestLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  succeeded: z.enum(["true", "false"]).optional(),
});

/**
 * Why a 1С login was turned away. Neither the login nor the password of the request is ever part of it, and
 * «wrong_credentials» does not say which of the two was wrong.
 */
export type OneCLoginRejection = "address_not_allowed" | "disabled" | "no_credentials" | "not_configured" | "wrong_credentials";
export type OneCLoginCheck = { reason: null; revision: string } | { reason: OneCLoginRejection; revision: null };

interface OneCSettingsRow {
  display_name?: string;
  expected_sync_minutes?: number;
  last_catalog_exchange_at?: Date | null;
  last_offers_exchange_at?: Date | null;
  allowed_networks: string[];
  is_enabled: boolean;
  last_exchange_at: Date | null;
  last_exchange_summary: Record<string, unknown>;
  secret_hash: Buffer | null;
  /** Exchange switches of this base; read through readOneCExchangeOptions. */
  settings?: unknown;
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
  /** Photos from <Картинка> attached / skipped (missing file, not an image, failed the malware or media check). Catalog runs only. */
  imagesAttached?: number;
  imagesSkipped?: number;
  /** A full catalogue named less than half of the live products, so the ones it does not list stayed on the shop. */
  hidingSkipped?: boolean;
  kind: "catalog" | "offers";
  /** Products already on the site (loaded under their 1С code before the exchange) that this file took over instead of adding them again. */
  productsAdopted?: number;
  /** Products a full catalogue no longer lists and hid from the shop. */
  productsHidden?: number;
  rowsRejected: number;
  rowsTouched: number;
  /** How many products this run filed under the explicit "Без категории" bucket instead of a real category -- see catalog-known-categories.ts. Always 0 for an "offers" run (price/stock only, no category assignment happens there). */
  rowsUncategorized: number;
}

export interface IntegrationRequestEvent {
  sourceKey?: OneCSource;
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

  async getSettings(source: OneCSource = "one_c"): Promise<Record<string, unknown>> {
    const row = await this.loadSettings(source);
    return this.safeSettings(row, source);
  }

  async updateSettings(
    rawInput: unknown,
    actor: AuthContext,
    ipAddress: string,
    userAgent?: string,
    source: OneCSource = "one_c",
  ): Promise<Record<string, unknown>> {
    const parsedInput = UpdateOneCSettingsSchema.safeParse(rawInput);
    if (!parsedInput.success) throw new BadRequestException("Некорректные настройки интеграции 1С");
    const input = parsedInput.data;
    sourceSql(source);
    return this.database.transaction(async (client) => {
      const existing = await client.query<OneCSettingsRow>(
        `SELECT is_enabled, username, secret_hash, allowed_networks::text[], updated_at,
                last_exchange_at, last_exchange_summary, display_name, expected_sync_minutes, last_catalog_exchange_at, last_offers_exchange_at, settings
         FROM app.integration_endpoints
         WHERE integration_key = ${sourceSql(source)}
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
      const displayName = input.displayName ?? before?.display_name ?? (source === "one_c" ? "Основная база 1С" : "Дополнительная база 1С");
      const expectedSyncMinutes = input.expectedSyncMinutes ?? before?.expected_sync_minutes ?? ONE_C_DEFAULT_EXPECTED_SYNC_MINUTES;
      // Only the switches this request names change; the rest keep their stored value.
      const options = namedOneCExchangeOptions(input);

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
            integration_key, is_enabled, username, secret_hash, allowed_networks,display_name,expected_sync_minutes, settings
          ) VALUES (${sourceSql(source)}, $1, $2, $3, $4::cidr[],$5,$6, $7::jsonb)
          ON CONFLICT (integration_key) DO UPDATE
          SET is_enabled = EXCLUDED.is_enabled,
              username = EXCLUDED.username,
              secret_hash = EXCLUDED.secret_hash,
              allowed_networks = EXCLUDED.allowed_networks,
              display_name = EXCLUDED.display_name,
              expected_sync_minutes = EXCLUDED.expected_sync_minutes,
              settings = app.integration_endpoints.settings || EXCLUDED.settings,
              updated_at = clock_timestamp()
          RETURNING is_enabled, username, secret_hash, allowed_networks::text[], updated_at,
                    last_exchange_at, last_exchange_summary, display_name, expected_sync_minutes, last_catalog_exchange_at, last_offers_exchange_at, settings
        `,
        [enabled, username, secret, allowedNetworks,displayName,expectedSyncMinutes, JSON.stringify(options)],
      );
      const after = updated.rows[0];
      if (after) { after.display_name = displayName; after.expected_sync_minutes = expectedSyncMinutes; }
      if (!after) throw new Error("1C settings update returned no row");
      await this.audit.record({
        action: "integration.one_c.settings_updated",
        actorRole: actor.role,
        actorUserId: actor.userId,
        afterState: this.safeSettings(after, source),
        beforeState: this.safeSettings(before, source),
        entityId: source,
        entityType: "integration_endpoint",
        ipAddress,
        metadata: { passwordRotated: Boolean(input.password) },
        userAgent,
      }, client);
      return this.safeSettings(after, source);
    });
  }

  async authorize(authorization: string | undefined, ipAddress: string, source: OneCSource = "one_c"): Promise<void> {
    try {
      await this.rateLimit.consume("one-c-ip", ipAddress, 60, 60);
    } catch (error) {
      await this.recordRequest({
        sourceKey: source, details: { outcome: "rate_limited" },
        ipAddress,
        operation: "authenticate",
        statusCode: 429,
        succeeded: false,
      });
      throw error;
    }

    const login = await this.checkCredentials(authorization, ipAddress, source);
    if (login.revision === null) {
      await this.recordRequest({
        sourceKey: source, details: { outcome: "rejected", reason: login.reason },
        ipAddress,
        operation: "authenticate",
        statusCode: 401,
        succeeded: false,
      });
      throw new UnauthorizedException("Интеграция 1С недоступна");
    }

    await this.database.query(
      `UPDATE app.integration_endpoints SET last_used_at = clock_timestamp() WHERE integration_key = ${sourceSql(source)}`,
    );
  }

  /**
   * Same credential + CIDR check as {@link authorize}, but for the
   * one-c-exchange CommerceML handshake (one-c-exchange.controller.ts):
   * mode=checkauth owns its own plain-text reply and request-log entry (a
   * "success\n<cookie>\n<value>" body has nothing in common with the JSON
   * machine endpoint's exception-driven response), so it needs a boolean
   * rather than a throw. Both transports authenticate against the same
   * configured source row. Each information base has its own credentials.
   */
  async verifyBasicAuth(authorization: string | undefined, ipAddress: string, source: OneCSource = "one_c"): Promise<boolean> {
    return await this.authenticateExchangeSession(authorization, ipAddress, source) !== null;
  }

  /** Returns the security revision from the same snapshot whose credentials were verified. */
  async authenticateExchangeSession(authorization: string | undefined, ipAddress: string, source: OneCSource = "one_c"): Promise<string | null> {
    return (await this.checkExchangeLogin(authorization, ipAddress, source)).revision;
  }

  /**
   * The same check, with the cause when the login is turned away. The cause goes to the request journal for the
   * staff («the address is not among the allowed networks» is the usual one for a cloud 1С); 1С itself gets the
   * same bare 401 whatever it was.
   */
  async checkExchangeLogin(authorization: string | undefined, ipAddress: string, source: OneCSource = "one_c"): Promise<OneCLoginCheck> {
    const login = await this.checkCredentials(authorization, ipAddress, source);
    if (login.revision !== null) {
      await this.database.query(
        `UPDATE app.integration_endpoints SET last_used_at = clock_timestamp() WHERE integration_key = ${sourceSql(source)}`,
      );
    }
    return login;
  }

  /** Cookie requests must still satisfy today's enabled flag, CIDR policy and credential revision. */
  async currentExchangeSessionRevision(ipAddress: string, source: OneCSource = "one_c"): Promise<string | null> {
    const row = (await this.database.query<{
      auth_revision: string;
      ip_allowed: boolean;
      is_enabled: boolean;
    }>(
      `SELECT auth_revision::text AS auth_revision,is_enabled,
              COALESCE($1::inet <<= ANY(allowed_networks),false) AS ip_allowed
       FROM app.integration_endpoints WHERE integration_key=${sourceSql(source)}`,
      [ipAddress],
    )).rows[0];
    return row?.is_enabled && row.ip_allowed ? row.auth_revision : null;
  }

  /** Denormalised onto the settings row by migration 0016 so the admin panel can show it without a second table -- see OneCExchangeSummary. */
  async recordExchangeResult(summary: OneCExchangeSummary, source: OneCSource = "one_c"): Promise<void> {
    await this.database.query(
      `UPDATE app.integration_endpoints
       SET last_exchange_at = clock_timestamp(), last_exchange_summary = $1::jsonb,
           last_catalog_exchange_at=CASE WHEN $2='catalog' THEN clock_timestamp() ELSE last_catalog_exchange_at END,
           last_offers_exchange_at=CASE WHEN $2='offers' THEN clock_timestamp() ELSE last_offers_exchange_at END
       WHERE integration_key = ${sourceSql(source)}`,
      [JSON.stringify(summary),summary.kind],
    );
  }

  private async checkCredentials(authorization: string | undefined, ipAddress: string, source: OneCSource = "one_c"): Promise<OneCLoginCheck> {
    const rejected = (reason: OneCLoginRejection): OneCLoginCheck => ({ reason, revision: null });
    const credentials = parseBasicAuthorization(authorization);
    if (!credentials) return rejected("no_credentials");
    const result = await this.database.query<OneCSettingsRow & { auth_revision: string; ip_allowed: boolean }>(
      `
        SELECT is_enabled, username, secret_hash, allowed_networks::text[], updated_at,
               last_exchange_at, last_exchange_summary, display_name, expected_sync_minutes, last_catalog_exchange_at, last_offers_exchange_at, auth_revision::text AS auth_revision,
               COALESCE($1::inet <<= ANY(allowed_networks), false) AS ip_allowed
        FROM app.integration_endpoints
        WHERE integration_key = ${sourceSql(source)}
      `,
      [ipAddress],
    );
    const settings = result.rows[0];
    // The first thing to put right comes first: a switched-off exchange, then the address, then the login.
    if (!settings) return rejected("not_configured");
    if (!settings.is_enabled) return rejected("disabled");
    if (!settings.ip_allowed) return rejected("address_not_allowed");
    if (!settings.username || !settings.secret_hash) return rejected("not_configured");

    const passwordMatches = await this.passwords.verify(credentials.password, settings.secret_hash.toString("utf8"));
    const usernameMatches = safeTextEqual(credentials.username, settings.username);
    return usernameMatches && passwordMatches ? { reason: null, revision: settings.auth_revision } : rejected("wrong_credentials");
  }

  async listRequests(rawQuery: unknown, source: OneCSource = "one_c"): Promise<Record<string, unknown>> {
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
       WHERE integration_key = ${sourceSql(source)} AND ($1::boolean IS NULL OR succeeded = $1)
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [succeeded, query.limit, query.offset],
    );
    const count = await this.database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM app.integration_request_log
       WHERE integration_key = ${sourceSql(source)} AND ($1::boolean IS NULL OR succeeded = $1)`,
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
    const source = event.sourceKey ?? "one_c";
    await this.database.query(
      `
        INSERT INTO app.integration_request_log (
          integration_key, operation, external_request_id, ip_address, succeeded,
          status_code, batch_id, payload_checksum, duration_ms, details
        ) VALUES (${sourceSql(source)}, $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
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

  /**
   * CommerceML runs of one base, newest first: what 1C sent, how far the
   * resumable import got, and the error a failed run stopped on. This is
   * the only place a failed exchange is visible -- last_exchange_summary is
   * written on success only.
   */
  async listExchangeRuns(rawQuery: unknown, source: OneCSource = "one_c"): Promise<Record<string, unknown>> {
    const parsed = ExchangeRunsQuerySchema.safeParse(rawQuery ?? {});
    if (!parsed.success) throw new BadRequestException("Некорректные параметры журнала обменов");
    const { limit, offset } = parsed.data;
    const rows = await this.database.query<{
      body_count: number; contains_only_changes: boolean; created_at: Date; cursor_index: number;
      error_message: string | null; filename: string; hiding_skipped: boolean; id: string; images_attached: number;
      images_skipped: number; kind: "catalog" | "offers"; phase: string; price_type_name: string | null; rows_rejected: number;
      products_adopted: number; products_hidden: number; rows_touched: number; rows_uncategorized: number; status: "completed" | "failed" | "running"; updated_at: Date;
    }>(
      `SELECT id::text, kind, filename, contains_only_changes, status, phase, cursor_index,
              jsonb_array_length(header_rows) + jsonb_array_length(body_rows)
                + COALESCE(jsonb_array_length(tail_rows), 0) AS body_count, rows_touched, rows_rejected, rows_uncategorized,
              images_attached, images_skipped, error_message, created_at, updated_at, price_type_name, products_hidden, hiding_skipped,
              products_adopted
       FROM app.one_c_exchange_runs
       WHERE source_key = ${sourceSql(source)}
       ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    const count = await this.database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM app.one_c_exchange_runs WHERE source_key = ${sourceSql(source)}`,
    );
    return {
      items: rows.rows.map((row) => ({
        containsOnlyChanges: row.contains_only_changes,
        createdAt: row.created_at.toISOString(),
        errorMessage: row.error_message,
        filename: row.filename,
        hidingSkipped: row.hiding_skipped,
        id: row.id,
        imagesAttached: row.images_attached,
        imagesSkipped: row.images_skipped,
        kind: row.kind,
        phase: row.phase,
        priceTypeName: row.price_type_name,
        productsAdopted: row.products_adopted,
        productsHidden: row.products_hidden,
        rowsInFile: row.body_count,
        rowsRejected: row.rows_rejected,
        rowsTouched: row.rows_touched,
        rowsUncategorized: row.rows_uncategorized,
        status: row.status,
        updatedAt: row.updated_at.toISOString(),
      })),
      limit,
      offset,
      total: Number(count.rows[0]?.count ?? 0),
    };
  }

  async getSources() {
    return { items: await Promise.all(ONE_C_SOURCES.map(source => this.getSettings(source))) };
  }

  private async loadSettings(source: OneCSource = "one_c"): Promise<OneCSettingsRow | undefined> {
    return (await this.database.query<OneCSettingsRow>(
      `SELECT is_enabled, username, secret_hash, allowed_networks::text[], updated_at,
              last_exchange_at, last_exchange_summary, display_name, expected_sync_minutes, last_catalog_exchange_at, last_offers_exchange_at, settings
       FROM app.integration_endpoints WHERE integration_key = ${sourceSql(source)}`,
    )).rows[0];
  }

  private safeSettings(row: OneCSettingsRow | undefined, source: OneCSource = "one_c"): Record<string, unknown> {
    const lastOffers = row?.last_offers_exchange_at;
    const expected = row?.expected_sync_minutes ?? ONE_C_DEFAULT_EXPECTED_SYNC_MINUTES;
    return {
      sourceKey: source,
      displayName: row?.display_name || (source === "one_c" ? "Основная база 1С" : "Дополнительная база 1С"),
      expectedSyncMinutes: expected,
      lastCatalogExchangeAt: row?.last_catalog_exchange_at?.toISOString() ?? null,
      lastOffersExchangeAt: lastOffers?.toISOString() ?? null,
      freshness: !row?.is_enabled ? "disabled" : !lastOffers ? "never" : Date.now()-lastOffers.getTime()>expected*2*60_000 ? "stale" : "current",
      allowedNetworks: row?.allowed_networks ?? [],
      enabled: row?.is_enabled ?? false,
      hasPassword: Boolean(row?.secret_hash),
      lastExchangeAt: row?.last_exchange_at?.toISOString() ?? null,
      lastExchangeSummary: row?.last_exchange_summary ?? {},
      ...readOneCExchangeOptions(row?.settings),
      updatedAt: row?.updated_at?.toISOString() ?? null,
      username: row?.username ?? null,
    };
  }
}
