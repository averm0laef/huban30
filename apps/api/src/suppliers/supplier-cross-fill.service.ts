import { randomUUID } from "node:crypto";

import { HttpException, Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import { UNLINKABLE_SECTIONS } from "@an30/contracts";

import { SUPPLIER_PROVIDER, type SupplierProvider } from "../adapters/provider-contracts.js";
import type { AuthContext } from "../auth/auth-context.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { RedisService } from "../infrastructure/redis.service.js";
import { AuditService } from "../security/audit.service.js";
import { decideSupplierLookup, type BrandIdentities } from "./supplier-cross-fill.logic.js";
import { SupplierCrossQueueService } from "./supplier-cross-queue.service.js";

export type CrossFillStop = "daily_limit" | "done" | "outside_hours" | "queue_unavailable" | "rate_limit" | "supplier_unavailable" | "switched_off";

export interface CrossFillReport {
  brandMismatch: number;
  lookups: number;
  error: string | null;
  finishedAt: string;
  found: number;
  noCrosses: number;
  notFound: number;
  pairsQueued: number;
  stopped: CrossFillStop;
}

export type CrossFillStart =
  | { started: true }
  | { reason: "already_running" | "daily_limit" | "outside_hours" | "supplier_disabled" | "switched_off"; started: false };

interface Candidate { brand: string; brand_id: string; id: string; sku: string; sku_normalized: string }

const BATCH = 25;
/** A number the supplier did not know, or knew without analogs, is asked again after this long. */
const RECHECK_DAYS = 90;
/** The shop is in Chita (UTC+9, no daylight saving). The filling works from 23:00 to 07:00 there. */
const CHITA_OFFSET_HOURS = 9;
const NIGHT_STARTS_AT = 23;
const NIGHT_ENDS_AT = 7;
const SETTING_KEY = "supplier_cross_fill";

export function isCrossFillHour(now: Date): boolean {
  const hour = (now.getUTCHours() + CHITA_OFFSET_HOURS) % 24;
  return hour >= NIGHT_STARTS_AT || hour < NIGHT_ENDS_AT;
}
/** A down supplier is not hammered: the run ends, the next one starts on the timer. */
const MAX_FAILURES_IN_A_ROW = 3;
const TICK_MS = 5 * 60 * 1_000;
const LOCK_KEY = "an30:rossko:cross-fill:lock";
// Longer than one lookup can take (25 s timeout + pause), renewed before each.
const LOCK_TTL_SECONDS = 120;

/**
 * Fills the shop's own cross base from the supplier ahead of time, without
 * waiting for a customer to search each number (docs/CATALOG_MATCHING.md,
 * «Наполнение от поставщика»).
 *
 * For every product of ours with a brand and an article: one supplier
 * search, counted against the shop's own background share of the day's
 * allowance (ROSSKO_CROSS_FILL_DAILY_LIMIT), never the customers' part. Only
 * the analogs of the part that carries our number under our brand are kept;
 * they go to app.article_crosses through the same queue and worker as a
 * customer's search, unconfirmed. What was asked is remembered in
 * app.supplier_cross_lookups, so a run continues where the last one stopped.
 * Goods in stock go first.
 *
 * Off until a member of staff switches it on: the owner's plan makes checking
 * the whole assortment conditional on the supplier's written consent. Once
 * on, it works only at night in Chita, one call every five seconds — 12 a
 * minute against the shop's own limit of 60 and the supplier's 300 — and
 * stops in the morning, at the night's limit, or when the supplier or the
 * queue is not answering.
 */
@Injectable()
export class SupplierCrossFillService implements OnModuleDestroy, OnModuleInit {
  /** Between two supplier calls. */
  pauseMs = 5_000;
  now: () => Date = () => new Date();
  lastRun: CrossFillReport | null = null;

  private readonly logger = new Logger(SupplierCrossFillService.name);
  private running: Promise<void> | null = null;
  private stopping = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly database: DatabaseService,
    @Inject(SUPPLIER_PROVIDER) private readonly supplier: SupplierProvider,
    private readonly crossQueue: SupplierCrossQueueService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    if (!this.supplier.enabled) return;
    this.timer = setInterval(() => {
      void this.start().catch((error: unknown) => {
        this.logger.warn(`cross fill did not start: ${error instanceof Error ? error.message : "unknown"}`);
      });
    }, TICK_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    clearInterval(this.timer);
    await this.running;
  }

  /** Resolves when no run is in progress (tests, shutdown). */
  async idle(): Promise<void> {
    await this.running;
  }

  /** Starts one background run unless one is in progress, here or in another API process. */
  async start(): Promise<CrossFillStart> {
    if (!this.supplier.enabled) return { reason: "supplier_disabled", started: false };
    if (this.running) return { reason: "already_running", started: false };
    if (!isCrossFillHour(this.now())) return { reason: "outside_hours", started: false };
    if (!await this.switchedOn()) return { reason: "switched_off", started: false };
    if (!await this.budgetLeft()) return { reason: "daily_limit", started: false };
    const token = randomUUID();
    await this.redis.ensureConnected();
    if (await this.redis.client.set(LOCK_KEY, token, "EX", LOCK_TTL_SECONDS, "NX") !== "OK") return { reason: "already_running", started: false };
    this.running = this.run(token)
      .then((report) => {
        this.lastRun = report;
        this.logger.log(`cross fill: ${report.lookups} numbers asked, ${report.pairsQueued} pairs queued, stopped: ${report.stopped}`);
      })
      .catch((error: unknown) => {
        this.logger.warn(`cross fill failed: ${error instanceof Error ? error.message : "unknown"}`);
      })
      .finally(async () => {
        this.running = null;
        await this.releaseLock(token);
      });
    return { started: true };
  }

  /** One run, awaited. */
  async run(lockToken?: string): Promise<CrossFillReport> {
    const report: CrossFillReport = {
      brandMismatch: 0, lookups: 0, error: null, finishedAt: "", found: 0, noCrosses: 0, notFound: 0, pairsQueued: 0, stopped: "done",
    };
    const identities = await this.brandIdentities();
    const attempted: string[] = [];
    // Numbers answered in this run: a second card of ours with the same number and brand is not asked again.
    const answered = new Set<string>();
    let failures = 0;
    run: while (!this.stopping) {
      const batch = await this.candidates(attempted);
      if (batch.length === 0) break;
      for (const product of batch) {
        if (this.stopping) break run;
        attempted.push(product.id);
        const asked = `${product.brand_id}:${product.sku_normalized}`;
        if (answered.has(asked)) continue;
        if (!isCrossFillHour(this.now())) { report.stopped = "outside_hours"; break run; }
        if (!await this.switchedOn()) { report.stopped = "switched_off"; break run; }
        if (!await this.budgetLeft()) { report.stopped = "daily_limit"; break run; }
        if (lockToken) await this.redis.client.set(LOCK_KEY, lockToken, "EX", LOCK_TTL_SECONDS);
        let result;
        try {
          result = await this.supplier.search(product.sku, "background");
        } catch (error) {
          if (error instanceof HttpException && error.getStatus() === 429) { report.stopped = "rate_limit"; break run; }
          throw error;
        }
        report.lookups += 1;
        if (!result.success) {
          // Not an answer: the product stays unrecorded and is asked in a later run.
          failures += 1;
          if (failures >= MAX_FAILURES_IN_A_ROW) {
            report.stopped = await this.budgetLeft() ? "supplier_unavailable" : "daily_limit";
            if (report.stopped === "supplier_unavailable") report.error = "Поставщик не отвечает. Наполнение продолжится позже.";
            break run;
          }
        } else {
          failures = 0;
          const decision = decideSupplierLookup(result.parts, product, identities);
          let queued = 0;
          if (decision.pairs.length > 0) {
            try {
              queued = await this.crossQueue.enqueueAndWait(decision.pairs);
            } catch {
              report.stopped = "queue_unavailable";
              report.error = "Очередь записи кроссов недоступна. Наполнение продолжится позже.";
              break run;
            }
          }
          await this.record(product, decision.status, queued, decision.note);
          answered.add(asked);
          report.pairsQueued += queued;
          if (decision.status === "found") report.found += 1;
          else if (decision.status === "no_crosses") report.noCrosses += 1;
          else if (decision.status === "brand_mismatch") report.brandMismatch += 1;
          else report.notFound += 1;
        }
        if (this.pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, this.pauseMs));
      }
    }
    report.finishedAt = new Date().toISOString();
    return report;
  }

  /** For the staff card: how far the filling has got and what it has spent today. */
  async status() {
    const [switchedOn, counts, usage] = await Promise.all([
      this.switchedOn(),
      this.database.query<{
        brand_mismatch: string; eligible: string; found: string; from_supplier: string; no_crosses: string; not_found: string;
      }>(
        `WITH own AS (
           SELECT product.id,product.sku_normalized,product.brand_id
           FROM app.products AS product
           JOIN app.brands AS brand ON brand.id=product.brand_id AND brand.is_active AND brand.deleted_at IS NULL
           LEFT JOIN app.categories AS category ON category.id=product.category_id
           LEFT JOIN app.categories AS parent ON parent.id=category.parent_id
           WHERE product.is_active AND product.deleted_at IS NULL AND length(product.sku_normalized)>=4
             AND (COALESCE(parent.slug,category.slug) IS NULL OR NOT COALESCE(parent.slug,category.slug)::text=ANY($1::text[]))
         ), looked AS (
           SELECT lookup.status FROM app.supplier_cross_lookups AS lookup
           JOIN own ON own.id=lookup.product_id AND own.sku_normalized=lookup.sku_normalized AND own.brand_id=lookup.brand_id
         )
         SELECT (SELECT count(*) FROM own)::text AS eligible,
                (SELECT count(*) FROM looked WHERE status='found')::text AS found,
                (SELECT count(*) FROM looked WHERE status='no_crosses')::text AS no_crosses,
                (SELECT count(*) FROM looked WHERE status='not_found')::text AS not_found,
                (SELECT count(*) FROM looked WHERE status='brand_mismatch')::text AS brand_mismatch,
                (SELECT count(*) FROM app.article_crosses WHERE 'rossko'=ANY(evidence))::text AS from_supplier`,
        [[...UNLINKABLE_SECTIONS]],
      ),
      this.supplier.usage?.() ?? null,
    ]);
    const row = counts.rows[0]!;
    const eligible = Number(row.eligible);
    const checked = Number(row.found) + Number(row.no_crosses) + Number(row.not_found) + Number(row.brand_mismatch);
    return {
      brandMismatch: Number(row.brand_mismatch),
      crossesFromSupplier: Number(row.from_supplier),
      eligible,
      enabled: this.supplier.enabled,
      nightHours: `${NIGHT_STARTS_AT}:00–0${NIGHT_ENDS_AT}:00 по Чите`,
      switchedOn,
      found: Number(row.found),
      lastRun: this.lastRun,
      noCrosses: Number(row.no_crosses),
      notFound: Number(row.not_found),
      pending: Math.max(0, eligible - checked),
      running: this.running !== null,
      usage,
    };
  }

  /** The staff switch. Every change is in the audit log. */
  async setEnabled(enabled: boolean, actor: AuthContext, request: { ipAddress?: string; userAgent?: string }) {
    await this.database.query(
      `INSERT INTO app.site_settings (key,value,is_public,updated_by) VALUES ($1,$2::jsonb,false,$3)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by`,
      [SETTING_KEY, JSON.stringify({ enabled }), actor.userId],
    );
    await this.audit.record({
      action: "supplier.cross_fill.switch",
      actorRole: actor.role,
      actorUserId: actor.userId,
      afterState: { enabled },
      entityType: "site_setting",
      ipAddress: request.ipAddress,
      userAgent: request.userAgent,
    });
    return { switchedOn: enabled };
  }

  private async switchedOn(): Promise<boolean> {
    const result = await this.database.query<{ value: { enabled?: unknown } }>("SELECT value FROM app.site_settings WHERE key=$1", [SETTING_KEY]);
    return result.rows[0]?.value.enabled === true;
  }

  private async budgetLeft(): Promise<boolean> {
    const usage = await this.supplier.usage?.() ?? null;
    return usage !== null && usage.backgroundUsed < usage.backgroundLimit;
  }

  private async candidates(attempted: readonly string[]): Promise<Candidate[]> {
    const result = await this.database.query<Candidate>(
      `SELECT product.id,product.sku::text AS sku,product.sku_normalized,product.brand_id,brand.name AS brand
       FROM app.products AS product
       JOIN app.brands AS brand ON brand.id=product.brand_id AND brand.is_active AND brand.deleted_at IS NULL
       LEFT JOIN app.categories AS category ON category.id=product.category_id
       LEFT JOIN app.categories AS parent ON parent.id=category.parent_id
       LEFT JOIN app.supplier_cross_lookups AS lookup
         ON lookup.product_id=product.id AND lookup.sku_normalized=product.sku_normalized AND lookup.brand_id=product.brand_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(sum(balance.quantity_on_hand-balance.quantity_reserved),0) AS available
         FROM app.inventory_balances AS balance WHERE balance.product_id=product.id
       ) AS stock ON true
       WHERE product.is_active AND product.deleted_at IS NULL AND length(product.sku_normalized)>=4
         AND (COALESCE(parent.slug,category.slug) IS NULL OR NOT COALESCE(parent.slug,category.slug)::text=ANY($1::text[]))
         AND (lookup.product_id IS NULL OR (lookup.status<>'found' AND lookup.checked_at<clock_timestamp()-make_interval(days => $2)))
         AND NOT product.id=ANY($3::uuid[])
       ORDER BY (stock.available>0) DESC,product.updated_at DESC,product.id
       LIMIT $4`,
      [[...UNLINKABLE_SECTIONS], RECHECK_DAYS, [...attempted], BATCH],
    );
    return result.rows;
  }

  /**
   * One answer serves every product of ours with the same number and brand (duplicate cards in 1С).
   * The number and brand asked are kept: when 1С changes either on a card, the old answer no longer counts.
   */
  private async record(product: Candidate, status: string, pairs: number, note: string | null): Promise<void> {
    await this.database.query(
      `INSERT INTO app.supplier_cross_lookups (product_id,sku_normalized,brand_id,status,pairs,note)
       SELECT product.id,product.sku_normalized,product.brand_id,$3,$4,$5 FROM app.products AS product
       WHERE product.sku_normalized=$1 AND product.brand_id=$2 AND product.is_active AND product.deleted_at IS NULL
       ON CONFLICT (product_id) DO UPDATE SET sku_normalized=EXCLUDED.sku_normalized,brand_id=EXCLUDED.brand_id,status=EXCLUDED.status,pairs=EXCLUDED.pairs,note=EXCLUDED.note,checked_at=clock_timestamp()`,
      [product.sku_normalized, product.brand_id, status, pairs, note],
    );
  }

  private async brandIdentities(): Promise<BrandIdentities> {
    const result = await this.database.query<{ alias: string; canonical: string }>("SELECT alias,canonical FROM app.brand_identities");
    return new Map(result.rows.map((row) => [row.alias, row.canonical]));
  }

  private async releaseLock(token: string): Promise<void> {
    try {
      if (await this.redis.client.get(LOCK_KEY) === token) await this.redis.client.del(LOCK_KEY);
    } catch {
      // The lock expires on its own.
    }
  }
}
