import { afterEach, describe, expect, it, vi } from "vitest";

import type { OneCIntegrationService } from "../catalog/one-c-integration.service.js";
import type { RedisService } from "../infrastructure/redis.service.js";
import { OneCExchangeSessionService } from "./one-c-exchange-session.service.js";

function fixture() {
  const values = new Map<string, string>();
  const policy = vi.fn<(ip: string) => Promise<string | null>>().mockResolvedValue("1");
  const set = vi.fn(async (key: string, value: string, _mode: string, _ttl: number) => {
    values.set(key, value);
    return "OK";
  });
  const redis = {
    ensureConnected: async () => undefined,
    client: {
      get: async (key: string) => values.get(key) ?? null,
      del: async (key: string) => values.delete(key) ? 1 : 0,
      set,
    },
  } as unknown as RedisService;
  const integration = { currentExchangeSessionRevision: policy } as unknown as OneCIntegrationService;
  const service = new OneCExchangeSessionService(redis, integration);
  return { policy, service, set, values };
}

afterEach(() => vi.restoreAllMocks());

describe("1C exchange session security", () => {
  it("cannot reuse another information base's cookie even when revisions and IP match",async()=>{
    const {service,values}=fixture();
    const primary=await service.issue("127.0.0.1","1","one_c");
    await expect(service.verify(primary,"127.0.0.1","one_c_secondary")).resolves.toBe(false);
    expect(values.size).toBe(1);
    await expect(service.verify(primary,"127.0.0.1","one_c")).resolves.toBe(true);
    const secondary=await service.issue("127.0.0.1","1","one_c_secondary");
    await expect(service.verify(secondary,"127.0.0.1","one_c")).resolves.toBe(false);
    await expect(service.verify(secondary,"127.0.0.1","one_c_secondary")).resolves.toBe(true);
  });
  it("accepts the bound IP only while current integration policy authorizes the original revision", async () => {
    const { service, policy } = fixture();
    const token = await service.issue("127.0.0.1", "1");
    await expect(service.verify(token, "127.0.0.1")).resolves.toBe(true);
    expect(policy).toHaveBeenCalledWith("127.0.0.1");
    policy.mockClear();
    await expect(service.verify(token, "127.0.0.2")).resolves.toBe(false);
    expect(policy).not.toHaveBeenCalled();
  });

  it.each(["disabled integration", "removed CIDR"])("revokes a cookie when the policy rejects it: %s", async () => {
    const { service, policy, values } = fixture();
    const token = await service.issue("127.0.0.1", "1");
    policy.mockResolvedValue(null);
    await expect(service.verify(token, "127.0.0.1")).resolves.toBe(false);
    expect(values.size).toBe(0);
    policy.mockResolvedValue("1");
    await expect(service.verify(token, "127.0.0.1")).resolves.toBe(false);
  });

  it.each(["password rotation", "username change", "CIDR change", "disable then re-enable"])(
    "rejects the prior generation after %s", async () => {
      const { service, policy, values } = fixture();
      const token = await service.issue("127.0.0.1", "1");
      policy.mockResolvedValue("2");
      await expect(service.verify(token, "127.0.0.1")).resolves.toBe(false);
      expect(values.size).toBe(0);
    },
  );

  it("enforces absolute two-hour expiry even when requests keep arriving", async () => {
    const { service, set } = fixture();
    const now = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const token = await service.issue("127.0.0.1", "1");
    now.mockReturnValue(1_800_000_000_000 + 7_199_000);
    await expect(service.verify(token, "127.0.0.1")).resolves.toBe(true);
    now.mockReturnValue(1_800_000_000_000 + 7_200_000);
    await expect(service.verify(token, "127.0.0.1")).resolves.toBe(false);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(expect.any(String), expect.any(String), "EX", 7_200);
  });

  it("invalidates legacy and malformed session records", async () => {
    const { service, values } = fixture();
    const token = await service.issue("127.0.0.1", "1");
    const key = `an30:one-c-exchange:session:${token}`;
    for (const value of ["127.0.0.1", "null", "{}", '{"authRevision":"1","ipAddress":"127.0.0.1"}']) {
      values.set(key, value);
      await expect(service.verify(token, "127.0.0.1")).resolves.toBe(false);
      expect(values.has(key)).toBe(false);
    }
  });
});
