import { Injectable } from "@nestjs/common";

import { RedisService } from "../infrastructure/redis.service.js";
import { CryptoService } from "../security/crypto.service.js";
import type { FapiVisitorShares } from "./engine/fapi-budget.js";

const PREFIX = "an30:fapi:visitor:";
/** A little over a day: a share is of one Moscow day and is of no use after it. */
const SHARE_SECONDS = 90_000;

// Both scripts run inside Redis, so two API instances cannot both take the last credits of a share.
const TAKE = `
  local used = redis.call('INCRBY', KEYS[1], ARGV[1])
  if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[3]) end
  if used > tonumber(ARGV[2]) then
    redis.call('DECRBY', KEYS[1], ARGV[1])
    return 0
  end
  return 1
`;
const GIVE_BACK = `
  if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
  local left = redis.call('DECRBY', KEYS[1], ARGV[1])
  if left < 0 then redis.call('INCRBY', KEYS[1], -left) end
  return 1
`;

/**
 * One visitor's share of the day's FAPI credits, counted in Redis: short-lived figures that have no place in the
 * credit ledger (its daily rows are summed as the site's spending). The visitor's address is never stored — only
 * a keyed hash of it, and the key is gone a day later.
 */
@Injectable()
export class RedisFapiVisitorShares implements FapiVisitorShares {
  constructor(
    private readonly redis: RedisService,
    private readonly crypto: CryptoService,
  ) {}

  async take(visitor: string, day: string, credits: number, limit: number): Promise<boolean> {
    await this.redis.ensureConnected();
    return Number(await this.redis.client.eval(TAKE, 1, this.key(visitor, day), String(credits), String(limit), String(SHARE_SECONDS))) === 1;
  }

  async giveBack(visitor: string, day: string, credits: number): Promise<void> {
    await this.redis.ensureConnected();
    await this.redis.client.eval(GIVE_BACK, 1, this.key(visitor, day), String(credits));
  }

  private key(visitor: string, day: string): string {
    return `${PREFIX}${day}:${this.crypto.opaqueHash("fapi-visitor", visitor).toString("hex").slice(0, 40)}`;
  }
}
