import { describe, expect, it, vi } from "vitest";

import type { DatabaseService } from "../infrastructure/database.service.js";
import type { AuditService } from "../security/audit.service.js";
import type { PasswordService } from "../security/password.service.js";
import type { RateLimitService } from "../security/rate-limit.service.js";
import { OneCIntegrationService } from "./one-c-integration.service.js";

function fixture(row?: Record<string, unknown>) {
  const query = vi.fn().mockResolvedValue({ rows: row ? [row] : [] });
  const verify = vi.fn().mockResolvedValue(true);
  const service = new OneCIntegrationService(
    {} as AuditService,
    { query } as unknown as DatabaseService,
    { verify } as unknown as PasswordService,
    {} as RateLimitService,
  );
  return { query, service, verify };
}

describe("1C session policy", () => {
  it("looks up the selected information base's independent credential revision",async()=>{
    const {service,query}=fixture({is_enabled:true,ip_allowed:true,auth_revision:"17"});
    await expect(service.currentExchangeSessionRevision("127.0.0.1","one_c_secondary")).resolves.toBe("17");
    expect(query.mock.calls[0]?.[0]).toContain("integration_key='one_c_secondary'");
  });
  it.each([
    { is_enabled: false, ip_allowed: true },
    { is_enabled: true, ip_allowed: false },
  ])("rejects sessions when enabled/network policy is %o", async (policy) => {
    const { service } = fixture({ ...policy, auth_revision: "7" });
    await expect(service.currentExchangeSessionRevision("127.0.0.1")).resolves.toBeNull();
  });

  it("rejects sessions after the integration row was removed", async () => {
    await expect(fixture().service.currentExchangeSessionRevision("127.0.0.1")).resolves.toBeNull();
  });

  it("returns the current revision only after checking the caller IP in PostgreSQL", async () => {
    const { service, query } = fixture({ is_enabled: true, ip_allowed: true, auth_revision: "7" });
    await expect(service.currentExchangeSessionRevision("192.0.2.7")).resolves.toBe("7");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("$1::inet <<= ANY(allowed_networks)"), ["192.0.2.7"]);
  });

  it("binds the issued session to the exact credential snapshot that passed verification", async () => {
    const { service, query, verify } = fixture({
      is_enabled: true, ip_allowed: true, auth_revision: "7", username: "one-c",
      secret_hash: Buffer.from("test-hash"),
    });
    query.mockImplementation(async (sql: string) => ({ rows: sql.includes("SELECT") ? [{
      is_enabled: true, ip_allowed: true, auth_revision: "7", username: "one-c",
      secret_hash: Buffer.from("test-hash"),
    }] : [] }));
    const authorization = `Basic ${Buffer.from("one-c:password").toString("base64")}`;
    await expect(service.authenticateExchangeSession(authorization, "127.0.0.1")).resolves.toBe("7");
    expect(verify).toHaveBeenCalledWith("password", "test-hash");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("skips database and password work when Basic authentication is absent", async () => {
    const { service, query, verify } = fixture();
    await expect(service.verifyBasicAuth(undefined, "192.0.2.7")).resolves.toBe(false);
    expect(query).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it.each([
    { is_enabled: false, ip_allowed: true },
    { is_enabled: true, ip_allowed: false },
  ])("skips password verification when the integration policy is %o", async (policy) => {
    const { service, verify } = fixture({ ...policy, username: "one-c", secret_hash: Buffer.from("test-hash") });
    const authorization = `Basic ${Buffer.from("one-c:password").toString("base64")}`;
    await expect(service.verifyBasicAuth(authorization, "192.0.2.7")).resolves.toBe(false);
    expect(verify).not.toHaveBeenCalled();
  });
});

describe("why 1С was turned away at the door", () => {
  // A turned-away 1С gets the same bare 401 whatever was wrong, so the owner can only learn the cause from the
  // site's own journal: a cloud 1С calls from addresses nobody knows in advance, and «the address is not among the
  // allowed networks» has to be told apart from «the password is wrong».
  const authorization = `Basic ${Buffer.from("one-c:password").toString("base64")}`;
  const configured = { auth_revision: "7", ip_allowed: true, is_enabled: true, secret_hash: Buffer.from("test-hash"), username: "one-c" };

  it.each([
    ["the exchange is switched off", { ...configured, is_enabled: false }, "disabled"],
    ["the address is not among the allowed networks", { ...configured, ip_allowed: false }, "address_not_allowed"],
    ["no login and password are set on the site", { ...configured, secret_hash: null, username: null }, "not_configured"],
    ["there are no settings for this base at all", undefined, "not_configured"],
  ] as const)("says that %s", async (_case, row, reason) => {
    const { service, verify } = fixture(row);
    await expect(service.checkExchangeLogin(authorization, "203.0.113.9")).resolves.toEqual({ reason, revision: null });
    expect(verify).not.toHaveBeenCalled();
  });

  it("says that the login or the password is wrong, without telling which", async () => {
    const wrongPassword = fixture(configured);
    wrongPassword.verify.mockResolvedValue(false);
    await expect(wrongPassword.service.checkExchangeLogin(authorization, "203.0.113.9")).resolves.toEqual({ reason: "wrong_credentials", revision: null });

    const wrongLogin = fixture(configured);
    const other = `Basic ${Buffer.from("somebody:password").toString("base64")}`;
    await expect(wrongLogin.service.checkExchangeLogin(other, "203.0.113.9")).resolves.toEqual({ reason: "wrong_credentials", revision: null });
  });

  it("says that the request carried no login and password", async () => {
    const { service, query } = fixture(configured);
    await expect(service.checkExchangeLogin(undefined, "203.0.113.9")).resolves.toEqual({ reason: "no_credentials", revision: null });
    expect(query).not.toHaveBeenCalled();
  });

  it("lets the right login in and gives the revision it was checked against", async () => {
    const { service } = fixture(configured);
    await expect(service.checkExchangeLogin(authorization, "203.0.113.9")).resolves.toEqual({ reason: null, revision: "7" });
  });

  it("writes the cause into the journal of the JSON door, and never the login or the password", async () => {
    const { query, service } = fixture({ ...configured, ip_allowed: false });
    (service as unknown as { rateLimit: { consume: () => Promise<void> } }).rateLimit = { consume: async () => undefined };

    await expect(service.authorize(authorization, "203.0.113.9")).rejects.toThrow("Интеграция 1С недоступна");

    const journal = query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO app.integration_request_log"));
    const written = JSON.stringify(journal?.[1]);
    expect(JSON.parse(String(journal?.[1]?.at(-1)))).toEqual({ outcome: "rejected", reason: "address_not_allowed" });
    expect(written).toContain("203.0.113.9");
    expect(written).not.toContain("password");
    expect(written).not.toContain("one-c");
  });
});
