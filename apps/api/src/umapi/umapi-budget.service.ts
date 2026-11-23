import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { DatabaseService } from "../infrastructure/database.service.js";
import { RedisService } from "../infrastructure/redis.service.js";
import { storeDay, storeHour } from "../tecdoc/tecdoc-budget.js";

export type UmapiBudgetRefusal = "day" | "hour";

const HOUR_PREFIX = "an30:umapi:hour:";
// Count the call only while the hour's share is not used up.
const TAKE_HOUR = `
  local used = tonumber(redis.call('GET', KEYS[1]) or '0')
  if used >= tonumber(ARGV[1]) then return 0 end
  redis.call('INCR', KEYS[1])
  redis.call('EXPIRE', KEYS[1], 7200)
  return 1
`;
const FLUSH_MS = 10_000;
const MIN_HOURLY = 20;

interface Tally { cacheHits: number; errors: number; refused: number }

/** The hour's share of a day: a fifth, so one busy hour or a script cannot spend the day. */
export function hourlyShare(daily: number, configured: number): number {
  return Math.min(daily, configured > 0 ? configured : Math.max(MIN_HOURLY, Math.ceil(daily * 0.2)));
}

/**
 * Counts UMAPI calls per hour (Redis) and per store day (PostgreSQL, shared by
 * every API instance) and refuses a call past the day's or the hour's share.
 * The tariff is a number of requests per day (docs/UMAPI_INTEGRATION.md, part 7).
 */
@Injectable()
export class UmapiBudgetService implements OnModuleDestroy {
  private readonly logger = new Logger(UmapiBudgetService.name);
  readonly dailyLimit: number;
  readonly hourlyLimit: number;
  private tally: Tally = { cacheHits: 0, errors: 0, refused: 0 };
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly database: DatabaseService,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.dailyLimit = config.get<number>("UMAPI_DAILY_LIMIT") ?? 9_000;
    this.hourlyLimit = hourlyShare(this.dailyLimit, config.get<number>("UMAPI_HOURLY_LIMIT") ?? 0);
    this.timer = setInterval(() => { void this.flush(); }, FLUSH_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }

  /** Takes one call out of the budget; a refusal names the limit that stopped it. */
  async take(now = new Date()): Promise<UmapiBudgetRefusal | null> {
    await this.redis.ensureConnected();
    const hourKey = HOUR_PREFIX + storeHour(now);
    if (Number(await this.redis.client.eval(TAKE_HOUR, 1, hourKey, String(this.hourlyLimit))) !== 1) return this.refuse("hour");
    const taken = await this.database.query(
      `INSERT INTO app.umapi_usage_daily (day,requests) VALUES ($1,1)
       ON CONFLICT (day) DO UPDATE SET requests=app.umapi_usage_daily.requests+1 WHERE app.umapi_usage_daily.requests<$2
       RETURNING requests`,
      [storeDay(now), this.dailyLimit],
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

  private refuse(reason: UmapiBudgetRefusal): UmapiBudgetRefusal {
    this.note("refused");
    return reason;
  }

  private async flush(): Promise<void> {
    const { cacheHits, errors, refused } = this.tally;
    if (cacheHits + errors + refused === 0) return;
    this.tally = { cacheHits: 0, errors: 0, refused: 0 };
    try {
      await this.database.query(
        `INSERT INTO app.umapi_usage_daily (day,cache_hits,refused,errors) VALUES ($1,$2,$3,$4)
         ON CONFLICT (day) DO UPDATE SET cache_hits=app.umapi_usage_daily.cache_hits+EXCLUDED.cache_hits,
           refused=app.umapi_usage_daily.refused+EXCLUDED.refused,errors=app.umapi_usage_daily.errors+EXCLUDED.errors`,
        [storeDay(new Date()), cacheHits, refused, errors],
      );
    } catch (error) {
      this.logger.warn(`usage counters not saved: ${error instanceof Error ? error.name : "unknown"}`);
    }
  }

  /** What the staff card shows: today and the last seven days. */
  async status(now = new Date()) {
    await this.flush();
    const day = storeDay(now);
    const week = await this.database.query<{ cache_hits: number; day: string; errors: number; refused: number; requests: number }>(
      "SELECT to_char(day,'YYYY-MM-DD') AS day,requests,cache_hits,refused,errors FROM app.umapi_usage_daily WHERE day>$1::date-7 ORDER BY day DESC LIMIT 7",
      [day],
    );
    const today = week.rows.find((row) => row.day === day);
    return {
      day,
      daily: { cacheHits: today?.cache_hits ?? 0, errors: today?.errors ?? 0, limit: this.dailyLimit, refused: today?.refused ?? 0, used: today?.requests ?? 0 },
      history: week.rows.map((row) => ({ cacheHits: row.cache_hits, day: row.day, requests: row.requests })),
      hourlyLimit: this.hourlyLimit,
    };
  }
}
