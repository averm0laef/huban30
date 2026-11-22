import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";

import { DatabaseService, type DatabaseExecutor } from "../infrastructure/database.service.js";
import type { FapiLedgerStore, FapiLedgerTx } from "./engine/fapi-budget.js";
import type { FapiUsage } from "./engine/fapi.js";
import { groupVariants, vehicleKeys, type FitmentRow } from "./engine/fitment.js";
import type { VehicleCacheKind, VehicleStore } from "./engine/vehicle-identity.js";
import type { FitmentLookup, FitmentVariant } from "./engine/vehicle-parts.js";

function toDate(epochSeconds: number): Date {
  return new Date(epochSeconds * 1000);
}

class PgLedgerTx implements FapiLedgerTx {
  constructor(private readonly client: DatabaseExecutor) {}

  async getCache(period: string, cacheKey: string, now: number): Promise<unknown> {
    const result = await this.client.query<{ payload: unknown }>(
      `UPDATE app.parts_finder_fapi_cache SET hits=hits+1
       WHERE period=$1 AND cache_key=$2 AND expires_at>$3 RETURNING payload`,
      [period, cacheKey, toDate(now)],
    );
    return result.rows[0]?.payload;
  }

  async getDaily(scope: string, day: string): Promise<number> {
    const result = await this.client.query<{ reserved: number }>(
      "SELECT reserved FROM app.parts_finder_fapi_daily WHERE scope=$1 AND day=$2::date",
      [scope, day],
    );
    return result.rows[0]?.reserved ?? 0;
  }

  async getPackage(period: string): Promise<number | null> {
    const result = await this.client.query<{ remaining: number }>(
      "SELECT remaining FROM app.parts_finder_fapi_packages WHERE period=$1",
      [period],
    );
    return result.rows[0]?.remaining ?? null;
  }

  async putCache(period: string, cacheKey: string, expires: number, payload: unknown): Promise<void> {
    await this.client.query(
      `INSERT INTO app.parts_finder_fapi_cache (period,cache_key,expires_at,payload) VALUES ($1,$2,$3,$4::jsonb)
       ON CONFLICT (period,cache_key) DO UPDATE SET expires_at=EXCLUDED.expires_at,payload=EXCLUDED.payload`,
      [period, cacheKey, toDate(expires), JSON.stringify(payload)],
    );
  }

  async setDaily(scope: string, day: string, reserved: number): Promise<void> {
    await this.client.query(
      `INSERT INTO app.parts_finder_fapi_daily (scope,day,reserved) VALUES ($1,$2::date,$3)
       ON CONFLICT (scope,day) DO UPDATE SET reserved=EXCLUDED.reserved`,
      [scope, day, Math.max(0, reserved)],
    );
  }

  async setPackage(period: string, remaining: number): Promise<void> {
    await this.client.query(
      `INSERT INTO app.parts_finder_fapi_packages (period,remaining) VALUES ($1,$2)
       ON CONFLICT (period) DO UPDATE SET remaining=EXCLUDED.remaining,updated_at=clock_timestamp()`,
      [period, remaining],
    );
  }
}

/** PostgreSQL ledger: one advisory lock serialises reservations across every API instance. */
@Injectable()
export class PgFapiLedgerStore implements FapiLedgerStore {
  constructor(private readonly database: DatabaseService) {}

  async deleteAccount(scope: string): Promise<void> {
    await this.database.query("DELETE FROM app.parts_finder_fapi_accounts WHERE scope=$1", [scope]);
  }

  async getAccount(scope: string): Promise<{ checked: number; usage: FapiUsage } | null> {
    const result = await this.database.query<{ checked: Date; usage: FapiUsage }>(
      "SELECT checked_at AS checked,usage FROM app.parts_finder_fapi_accounts WHERE scope=$1",
      [scope],
    );
    const row = result.rows[0];
    return row ? { checked: row.checked.getTime() / 1000, usage: row.usage } : null;
  }

  async purgeExpiredCache(now: number): Promise<void> {
    await this.database.query("DELETE FROM app.parts_finder_fapi_cache WHERE expires_at<=$1", [toDate(now)]);
  }

  async saveAccount(scope: string, checked: number, usage: FapiUsage): Promise<void> {
    await this.database.query(
      `INSERT INTO app.parts_finder_fapi_accounts (scope,checked_at,usage) VALUES ($1,$2,$3::jsonb)
       ON CONFLICT (scope) DO UPDATE SET checked_at=EXCLUDED.checked_at,usage=EXCLUDED.usage`,
      [scope, toDate(checked), JSON.stringify(usage)],
    );
    // Package balance for the staff dashboard (provider "fapi").
    if (typeof usage.remaining_credits === "number") {
      const end = typeof usage.period_end === "string" ? Date.parse(usage.period_end) : Number.NaN;
      await this.database.query(
        `INSERT INTO app.parts_finder_provider_quotas (provider,quota_limit,remaining,reset_at) VALUES ('fapi',$1,$2,$3)
         ON CONFLICT (provider) DO UPDATE SET quota_limit=EXCLUDED.quota_limit,remaining=EXCLUDED.remaining,
           reset_at=EXCLUDED.reset_at,updated_at=clock_timestamp()`,
        [typeof usage.included_credits === "number" ? usage.included_credits : null, usage.remaining_credits,
          Number.isFinite(end) ? new Date(end) : toDate(checked + 86_400)],
      );
    }
  }

  transaction<T>(work: (tx: FapiLedgerTx) => Promise<T>): Promise<T> {
    return this.database.transaction(async (client: PoolClient) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('an30:parts-finder:fapi-ledger'))");
      return work(new PgLedgerTx(client));
    });
  }

  /** Today's reserved credits and the latest known package remainder, for staff. */
  async summary(day: string): Promise<{ checkedAt: string | null; reservedToday: number; usage: FapiUsage | null; cachedEntries: number; cacheHits: number }> {
    const [daily, account, cache] = await Promise.all([
      this.database.query<{ reserved: string }>("SELECT COALESCE(sum(reserved),0)::text AS reserved FROM app.parts_finder_fapi_daily WHERE day=$1::date", [day]),
      this.database.query<{ checked_at: Date; usage: FapiUsage }>("SELECT checked_at,usage FROM app.parts_finder_fapi_accounts ORDER BY checked_at DESC LIMIT 1"),
      this.database.query<{ entries: string; hits: string }>(
        "SELECT count(*)::text AS entries,COALESCE(sum(hits),0)::text AS hits FROM app.parts_finder_fapi_cache WHERE expires_at>clock_timestamp()",
      ),
    ]);
    const row = account.rows[0];
    return {
      cacheHits: Number(cache.rows[0]?.hits ?? 0),
      cachedEntries: Number(cache.rows[0]?.entries ?? 0),
      checkedAt: row ? row.checked_at.toISOString() : null,
      reservedToday: Number(daily.rows[0]?.reserved ?? 0),
      usage: row?.usage ?? null,
    };
  }
}

@Injectable()
export class PgVehicleStore implements VehicleStore {
  constructor(private readonly database: DatabaseService) {}

  async getCached(kind: VehicleCacheKind, identifier: string): Promise<unknown> {
    const result = await this.database.query<{ payload: unknown }>(
      `UPDATE app.parts_finder_vehicle_cache SET hits=hits+1,last_hit_at=clock_timestamp()
       WHERE kind=$1 AND identifier=$2 AND expires_at>clock_timestamp() RETURNING payload`,
      [kind, identifier],
    );
    return result.rows[0]?.payload;
  }

  async getQuota(provider: string): Promise<{ remaining: number; resetAt: number } | null> {
    const result = await this.database.query<{ remaining: number; reset_at: Date }>(
      "SELECT remaining,reset_at FROM app.parts_finder_provider_quotas WHERE provider=$1",
      [provider],
    );
    const row = result.rows[0];
    return row ? { remaining: row.remaining, resetAt: row.reset_at.getTime() / 1000 } : null;
  }

  async putCached(kind: VehicleCacheKind, identifier: string, payload: unknown, ttlSeconds: number): Promise<void> {
    await this.database.query(
      `INSERT INTO app.parts_finder_vehicle_cache (kind,identifier,payload,expires_at)
       VALUES ($1,$2,$3::jsonb,clock_timestamp()+make_interval(secs => $4))
       ON CONFLICT (kind,identifier) DO UPDATE SET payload=EXCLUDED.payload,expires_at=EXCLUDED.expires_at`,
      [kind, identifier, JSON.stringify(payload), ttlSeconds],
    );
  }

  async saveQuota(provider: string, limit: number | null, remaining: number, resetAt: number): Promise<void> {
    await this.database.query(
      `INSERT INTO app.parts_finder_provider_quotas (provider,quota_limit,remaining,reset_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (provider) DO UPDATE SET quota_limit=EXCLUDED.quota_limit,remaining=EXCLUDED.remaining,
         reset_at=EXCLUDED.reset_at,updated_at=clock_timestamp()`,
      [provider, limit, remaining, toDate(resetAt)],
    );
  }

  async summary(): Promise<{ entries: number; hits: number; vinrokuRemaining: number | null }> {
    const [cache, quota] = await Promise.all([
      this.database.query<{ entries: string; hits: string }>(
        "SELECT count(*)::text AS entries,COALESCE(sum(hits),0)::text AS hits FROM app.parts_finder_vehicle_cache",
      ),
      this.getQuota("vinroku"),
    ]);
    return {
      entries: Number(cache.rows[0]?.entries ?? 0),
      hits: Number(cache.rows[0]?.hits ?? 0),
      vinrokuRemaining: quota && quota.resetAt > Date.now() / 1000 ? quota.remaining : null,
    };
  }
}

interface FitmentDbRow {
  article: string;
  brand: string;
  category: string;
  configuration: string;
  engine: string;
  liters: string | null;
  make: string;
  make_key: string;
  model: string;
  model_key: string;
  oem: boolean;
  source: string;
  year_from: number | null;
  year_to: number | null;
}

@Injectable()
export class PgFitmentStore implements FitmentLookup {
  constructor(private readonly database: DatabaseService) {}

  async variants(tokens: readonly string[], category: string, year: number | null, engine: string | null, liters: number | null): Promise<Map<number, FitmentVariant>> {
    const keys = vehicleKeys(tokens);
    if (keys.length === 0) return new Map();
    const result = await this.database.query<FitmentDbRow>(
      `SELECT make,model,category,configuration,engine,liters::text,year_from,year_to,article,brand,oem,source,make_key,model_key
       FROM app.parts_fitment WHERE category=$1 AND make_key=ANY($2::text[]) AND model_key=ANY($2::text[])
       ORDER BY make COLLATE "C",model COLLATE "C",configuration COLLATE "C",article COLLATE "C"`,
      [category, keys],
    );
    return groupVariants(result.rows.map((row): FitmentRow => ({
      article: row.article, brand: row.brand, category: row.category, configuration: row.configuration, engine: row.engine,
      liters: row.liters === null ? null : Number(row.liters), make: row.make, makeKey: row.make_key, model: row.model,
      modelKey: row.model_key, oem: row.oem, source: row.source, yearFrom: row.year_from, yearTo: row.year_to,
    })), year, engine, liters);
  }
}

/** Replaces every fitment row in one transaction (import CLI). */
export async function replaceFitment(client: DatabaseExecutor, rows: readonly FitmentRow[]): Promise<number> {
  await client.query("DELETE FROM app.parts_fitment");
  for (let offset = 0; offset < rows.length; offset += 500) {
    const batch = rows.slice(offset, offset + 500);
    await client.query(
      `INSERT INTO app.parts_fitment (make,model,category,configuration,engine,liters,year_from,year_to,article,brand,oem,source,make_key,model_key)
       SELECT make,model,category,configuration,engine,liters,year_from,year_to,article,brand,oem,source,make_key,model_key
       FROM jsonb_to_recordset($1::jsonb) AS row(make text,model text,category text,configuration text,engine text,liters numeric,
         year_from integer,year_to integer,article text,brand text,oem boolean,source text,make_key text,model_key text)`,
      [JSON.stringify(batch.map((row) => ({
        article: row.article, brand: row.brand, category: row.category, configuration: row.configuration, engine: row.engine,
        liters: row.liters, make: row.make, make_key: row.makeKey, model: row.model, model_key: row.modelKey, oem: row.oem,
        source: row.source, year_from: row.yearFrom, year_to: row.yearTo,
      })))],
    );
  }
  return rows.length;
}
