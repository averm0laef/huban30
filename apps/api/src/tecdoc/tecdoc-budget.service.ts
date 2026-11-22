import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { DatabaseService } from "../infrastructure/database.service.js";
import { RedisService } from "../infrastructure/redis.service.js";
import { allowanceFor, storeDay, storeHour, type Allowance, type BudgetSettings } from "./tecdoc-budget.js";

export type BudgetRefusal = "day" | "hour" | "package";

const HOUR_PREFIX = "an30:tecdoc:hour:";
// Count the call only while the hour's share is not used up.
const TAKE_HOUR = `
  local used = tonumber(redis.call('GET', KEYS[1]) or '0')
  if used >= tonumber(ARGV[1]) then return 0 end
  redis.call('INCR', KEYS[1])
  redis.call('EXPIRE', KEYS[1], 7200)
  return 1
`;
const USED_BEFORE_TODAY_TTL_MS = 60_000;
const FLUSH_MS = 10_000;

interface Tally { cacheHits: number; errors: number; refused: number }

/**
 * Counts provider calls per hour (Redis) and per day (PostgreSQL, shared by
 * every API instance and kept across restarts) and refuses a call that would
 * exceed the day's or the hour's share of the paid package.
 */
@Injectable()
export class TecdocBudgetService implements OnModuleDestroy {
  private readonly logger = new Logger(TecdocBudgetService.name);
  private readonly settings: BudgetSettings;
  private usedBefore: { at: number; day: string; value: number } | null = null;
  private tally: Tally = { cacheHits: 0, errors: 0, refused: 0 };
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly database: DatabaseService,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.settings = {
      dailyLimit: config.get<number>("TECDOC_DAILY_LIMIT") ?? 0,
      hourlyLimit: config.get<number>("TECDOC_HOURLY_LIMIT") ?? 0,
      monthlyLimit: config.get<number>("TECDOC_MONTHLY_LIMIT") ?? 150_000,
      periodStart: config.get<string>("TECDOC_PERIOD_START") ?? null,
    };
    this.timer = setInterval(() => { void this.flush(); }, FLUSH_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }

  /** Takes one call out of the budget; a refusal names the limit that stopped it. */
  async take(now = new Date()): Promise<BudgetRefusal | null> {
    const day = storeDay(now);
    const allowance = await this.allowance(day);
    if (allowance.daily <= 0) return this.refuse("package");
    await this.redis.ensureConnected();
    const hourKey = HOUR_PREFIX + storeHour(now);
    if (Number(await this.redis.client.eval(TAKE_HOUR, 1, hourKey, String(allowance.hourly))) !== 1) return this.refuse("hour");
    const taken = await this.database.query(
      `INSERT INTO app.tecdoc_usage_daily (day,requests) VALUES ($1,1)
       ON CONFLICT (day) DO UPDATE SET requests=app.tecdoc_usage_daily.requests+1 WHERE app.tecdoc_usage_daily.requests<$2
       RETURNING requests`,
      [day, allowance.daily],
    );
    if (taken.rowCount === 0) {
      await this.redis.client.decr(hourKey).catch(() => undefined);
      return this.refuse("day");
    }
    return null;
  }

  note(kind: keyof Tally): void {
    this.tally[kind] += 1;
  }

  private refuse(reason: BudgetRefusal): BudgetRefusal {
    this.note("refused");
    return reason;
  }

  private async allowance(day: string): Promise<Allowance> {
    const period = allowanceFor(day, 0, this.settings).period;
    if (!this.usedBefore || this.usedBefore.day !== day || Date.now() - this.usedBefore.at > USED_BEFORE_TODAY_TTL_MS) {
      const result = await this.database.query<{ used: string }>(
        "SELECT COALESCE(sum(requests),0)::text AS used FROM app.tecdoc_usage_daily WHERE day>=$1 AND day<$2",
        [period.start, day],
      );
      this.usedBefore = { at: Date.now(), day, value: Number(result.rows[0]?.used ?? 0) };
    }
    return allowanceFor(day, this.usedBefore.value, this.settings);
  }

  private async flush(): Promise<void> {
    const { cacheHits, errors, refused } = this.tally;
    if (cacheHits + errors + refused === 0) return;
    this.tally = { cacheHits: 0, errors: 0, refused: 0 };
    try {
      await this.database.query(
        `INSERT INTO app.tecdoc_usage_daily (day,cache_hits,refused,errors) VALUES ($1,$2,$3,$4)
         ON CONFLICT (day) DO UPDATE SET cache_hits=app.tecdoc_usage_daily.cache_hits+EXCLUDED.cache_hits,
           refused=app.tecdoc_usage_daily.refused+EXCLUDED.refused,errors=app.tecdoc_usage_daily.errors+EXCLUDED.errors`,
        [storeDay(new Date()), cacheHits, refused, errors],
      );
    } catch (error) {
      this.logger.warn(`usage counters not saved: ${error instanceof Error ? error.name : "unknown"}`);
    }
  }

  /** What the staff card shows. */
  async status(now = new Date()) {
    await this.flush();
    const day = storeDay(now);
    const allowance = await this.allowance(day);
    const [today, period, week] = await Promise.all([
      this.database.query<{ cache_hits: number; errors: number; refused: number; requests: number }>(
        "SELECT requests,cache_hits,refused,errors FROM app.tecdoc_usage_daily WHERE day=$1", [day]),
      this.database.query<{ used: string }>(
        "SELECT COALESCE(sum(requests),0)::text AS used FROM app.tecdoc_usage_daily WHERE day>=$1 AND day<$2", [allowance.period.start, allowance.period.end]),
      this.database.query<{ cache_hits: number; day: string; requests: number }>(
        "SELECT to_char(day,'YYYY-MM-DD') AS day,requests,cache_hits FROM app.tecdoc_usage_daily WHERE day>$1::date-7 ORDER BY day DESC LIMIT 7", [day]),
    ]);
    let hourUsed = 0;
    try {
      await this.redis.ensureConnected();
      hourUsed = Number(await this.redis.client.get(HOUR_PREFIX + storeHour(now)) ?? 0);
    } catch {
      // The card still shows the daily numbers.
    }
    const row = today.rows[0];
    return {
      day,
      daily: { cacheHits: row?.cache_hits ?? 0, errors: row?.errors ?? 0, limit: allowance.daily, refused: row?.refused ?? 0, used: row?.requests ?? 0 },
      hourly: { limit: allowance.hourly, used: hourUsed },
      history: week.rows.map((item) => ({ cacheHits: item.cache_hits, day: item.day, requests: item.requests })),
      period: { end: allowance.period.end, limit: this.settings.monthlyLimit, start: allowance.period.start, used: Number(period.rows[0]?.used ?? 0) },
    };
  }
}
