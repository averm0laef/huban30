import { describe, expect, it, vi } from "vitest";

import { BadRequestException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";

import type { DatabaseService } from "../infrastructure/database.service.js";
import type { AuditService } from "../security/audit.service.js";
import type { CryptoService } from "../security/crypto.service.js";
import type { PasswordService } from "../security/password.service.js";
import type { TotpService } from "../security/totp.service.js";
import { AuthService, assertStrongPassword, canRefreshPendingRegistration } from "./auth.service.js";
import type { SessionService } from "./session.service.js";

describe("auth account state policy", () => {
  it("allows registration refresh only for an unverified pending account", () => {
    expect(canRefreshPendingRegistration(undefined)).toBe(true);
    expect(canRefreshPendingRegistration("pending_email")).toBe(true);
    expect(canRefreshPendingRegistration("active")).toBe(false);
    expect(canRefreshPendingRegistration("suspended")).toBe(false);
    expect(canRefreshPendingRegistration("disabled")).toBe(false);
  });

  it("rejects common passwords and password phrases containing the email local part", () => {
    expect(() => assertStrongPassword("password1234", "client@example.test"))
      .toThrow(BadRequestException);
    expect(() => assertStrongPassword("client-secure-phrase", "client@example.test"))
      .toThrow(BadRequestException);
    expect(() => assertStrongPassword("different-secure-phrase", "client@example.test"))
      .not.toThrow();
  });

  it("does not create a session when the password hash changes after verification", async () => {
    const initial = {
      email: "client@example.test",
      failed_login_count: 0,
      id: "019bf9ea-0d3e-7def-8c9a-000000000001",
      locked_until: null,
      password_hash: "old-hash",
      role: null,
      staff_status: null,
      status: "active",
      totp_confirmed_at: null,
    };
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [{ ...initial, password_hash: "new-hash" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const database = {
      query: vi.fn().mockResolvedValue({ rows: [initial] }),
      transaction: vi.fn(async (work: (client: { query: typeof clientQuery }) => Promise<unknown>) => (
        work({ query: clientQuery })
      )),
    };
    const sessions = { create: vi.fn() };
    const service = new AuthService(
      { getOrThrow: () => false } as unknown as ConfigService,
      { record: vi.fn() } as unknown as AuditService,
      {} as CryptoService,
      database as unknown as DatabaseService,
      { verify: vi.fn().mockResolvedValue(true) } as unknown as PasswordService,
      sessions as unknown as SessionService,
      {} as TotpService,
    );

    await expect(service.login(
      { email: initial.email, password: "old-password" },
      { ipAddress: "127.0.0.1" },
    )).rejects.toThrow("Неверный email или пароль");
    expect(sessions.create).not.toHaveBeenCalled();
    expect(String(clientQuery.mock.calls[0]?.[0])).toContain("FOR UPDATE OF account");
  });
});
