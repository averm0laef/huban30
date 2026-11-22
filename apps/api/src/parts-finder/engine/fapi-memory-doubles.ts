// In-memory stand-ins for the credit ledger (PostgreSQL in production) and for the visitors' shares of the day
// (Redis in production). Used by the tests of the budget and of the engine; nothing here runs in the application.
import type { FapiLedgerStore, FapiLedgerTx, FapiVisitorShares } from "./fapi-budget.js";
import type { FapiUsage } from "./fapi.js";

/** The credit ledger, in memory. */
export class MemoryLedger implements FapiLedgerStore {
  accounts = new Map<string, { checked: number; usage: FapiUsage }>();
  packages = new Map<string, number>();
  daily = new Map<string, number>();
  cache = new Map<string, { expires: number; payload: unknown }>();
  async deleteAccount(scope: string) { this.accounts.delete(scope); }
  async getAccount(scope: string) { return this.accounts.get(scope) ?? null; }
  async purgeExpiredCache(now: number) { for (const [key, value] of this.cache) if (value.expires <= now) this.cache.delete(key); }
  async saveAccount(scope: string, checked: number, usage: FapiUsage) { this.accounts.set(scope, { checked, usage }); }
  async transaction<T>(work: (tx: FapiLedgerTx) => Promise<T>): Promise<T> {
    const tx: FapiLedgerTx = {
      getCache: async (period, key, now) => {
        const hit = this.cache.get(`${period}|${key}`);
        return hit && hit.expires > now ? hit.payload : undefined;
      },
      getDaily: async (scope, day) => this.daily.get(`${scope}|${day}`) ?? 0,
      getPackage: async (period) => this.packages.get(period) ?? null,
      putCache: async (period, key, expires, payload) => { this.cache.set(`${period}|${key}`, { expires, payload }); },
      setDaily: async (scope, day, reserved) => { this.daily.set(`${scope}|${day}`, reserved); },
      setPackage: async (period, remaining) => { this.packages.set(period, remaining); },
    };
    return work(tx);
  }
  totalDaily() { return [...this.daily.values()].reduce((sum, value) => sum + value, 0); }
}

/** The visitors' shares of the day, in memory (Redis in production). */
export class MemoryShares implements FapiVisitorShares {
  used = new Map<string, number>();
  failing = false;
  /** When set, a take waits for it: lets a test put a second request beside one that is being decided. */
  hold: Promise<void> | null = null;
  waiting = 0;
  async take(visitor: string, day: string, credits: number, limit: number) {
    if (this.failing) throw new Error("the shares cannot be counted");
    if (this.hold) {
      this.waiting += 1;
      await this.hold;
    }
    const next = (this.used.get(`${visitor}|${day}`) ?? 0) + credits;
    if (next > limit) return false;
    this.used.set(`${visitor}|${day}`, next);
    return true;
  }
  async giveBack(visitor: string, day: string, credits: number) {
    this.used.set(`${visitor}|${day}`, Math.max(0, (this.used.get(`${visitor}|${day}`) ?? 0) - credits));
  }
  of(visitor: string) { return [...this.used].filter(([key]) => key.startsWith(`${visitor}|`)).reduce((sum, [, value]) => sum + value, 0); }
}
