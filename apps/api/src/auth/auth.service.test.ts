import { describe, expect, it, vi } from "vitest";

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";

import {
  REGISTRATION_PERSONAL_DATA_CONSENT_TEXT,
  REGISTRATION_PERSONAL_DATA_CONSENT_VERSION,
} from "@an30/contracts";

import type { DatabaseService } from "../infrastructure/database.service.js";
import type { AuditService } from "../security/audit.service.js";
import { normalizeConsentUserAgent } from "../security/consent-evidence.js";
import type { CryptoService } from "../security/crypto.service.js";
import type { PasswordService } from "../security/password.service.js";
import type { TotpService } from "../security/totp.service.js";
import {
  AuthService,
  assertStrongPassword,
  canRefreshPendingRegistration,
} from "./auth.service.js";
import type { SessionService } from "./session.service.js";

const CONFIG_DEFAULTS: Record<string, unknown> = {
  APP_ORIGIN: "https://staging.an30.ru",
  AUTH_ADMIN_TOKEN_LOOKUP: false,
  AUTH_DEBUG_TOKENS: false,
  LEGAL_DOCUMENTS_APPROVED: true,
};

function configStub(overrides: Record<string, unknown> = {}): ConfigService {
  const values = { ...CONFIG_DEFAULTS, ...overrides };
  return { getOrThrow: (key: string) => values[key] } as unknown as ConfigService;
}

describe("email verification", () => {
  it.each([false, true])("requires the registration password before activating the account (%s)", async (matches) => {
    const account = { id: "019bf9ea-0d3e-7def-8c9a-0000000000cc", password_hash: "pending-password-hash" };
    const tokenHash = Buffer.from("verification-hash");
    const query = vi.fn().mockResolvedValue({ rows: [account] });
    const clientQuery = vi.fn().mockResolvedValue({ rowCount: 1 });
    const transaction = vi.fn((work: (client: { query: typeof clientQuery }) => Promise<unknown>) => work({ query: clientQuery }));
    const verify = vi.fn().mockResolvedValue(matches);
    const record = vi.fn();
    const service = new AuthService(
      configStub(),
      { record } as unknown as AuditService,
      { opaqueHash: vi.fn().mockReturnValue(tokenHash) } as unknown as CryptoService,
      { query, transaction } as unknown as DatabaseService,
      { verify } as unknown as PasswordService,
      {} as SessionService,
      {} as TotpService,
    );

    const result = service.verifyEmail({ token: "email-token", password: "registration password" }, { ipAddress: "192.0.2.7" });
    if (matches) {
      await expect(result).resolves.toMatchObject({ userId: account.id });
      expect(clientQuery).toHaveBeenNthCalledWith(1, expect.stringContaining("FOR UPDATE"), [account.id, account.password_hash]);
      expect(clientQuery).toHaveBeenNthCalledWith(2, expect.stringContaining("used_at IS NULL"), [account.id, tokenHash]);
      expect(clientQuery).toHaveBeenNthCalledWith(3, expect.stringContaining("status = 'active'"), [account.id]);
    } else {
      await expect(result).rejects.toThrow(BadRequestException);
      expect(transaction).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    }
    expect(verify).toHaveBeenCalledWith("registration password", account.password_hash);
  });
});

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

  it("rejects passwords that are long but trivially guessable", () => {
    for (const password of [
      "aaaaaaaaaaaa",
      "111111111111",
      "            ",
      "abab abab abab",
      "qwertyuiopas",
      "QWERTYUIOPASDF",
      "abcdefghijkl",
      "098765432109",
      "йцукенгшщзхъ",
    ]) {
      expect(() => assertStrongPassword(password), password).toThrow(BadRequestException);
    }
    for (const password of ["long password phrase", "Синий трамвай 42", "correct horse battery"]) {
      expect(() => assertStrongPassword(password), password).not.toThrow();
    }
  });

  it("bounds and removes control characters from consent request metadata", () => {
    expect(normalizeConsentUserAgent(undefined)).toBeNull();
    expect(normalizeConsentUserAgent("  Browser\u0000Name\n1  ")).toBe("Browser Name 1");
    expect(normalizeConsentUserAgent("x".repeat(1_100))).toHaveLength(1_024);
  });

  it("fails closed before hashing or database access when legal documents are not approved", async () => {
    const database = { transaction: vi.fn() };
    const passwords = { hash: vi.fn() };
    const service = new AuthService(
      configStub({ LEGAL_DOCUMENTS_APPROVED: false }),
      {} as AuditService,
      {} as CryptoService,
      database as unknown as DatabaseService,
      passwords as unknown as PasswordService,
      {} as SessionService,
      {} as TotpService,
    );

    await expect(service.register({
      displayName: "Антон Ермолаев",
      email: "client@example.test",
      password: "different-secure-phrase",
      personalDataConsent: true,
      personalDataConsentVersion: REGISTRATION_PERSONAL_DATA_CONSENT_VERSION,
    }, { ipAddress: "203.0.113.30" })).rejects.toThrow(ServiceUnavailableException);
    expect(passwords.hash).not.toHaveBeenCalled();
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("stores immutable registration consent evidence in the account transaction", async () => {
    const userId = "019bf9ea-0d3e-7def-8c9a-0000000000cc";
    const clientQuery = vi.fn(async (statement: string, _parameters?: unknown[]) => {
      if (statement.includes("SELECT id, status::text FROM app.users")) return { rows: [] };
      if (statement.includes("INSERT INTO app.users")) return { rows: [{ id: userId }] };
      return { rows: [] };
    });
    const database = {
      transaction: vi.fn(async (work: (client: { query: typeof clientQuery }) => Promise<unknown>) => (
        work({ query: clientQuery })
      )),
    };
    const audit = { record: vi.fn() };
    const service = new AuthService(
      configStub(),
      audit as unknown as AuditService,
      {
        encrypt: vi.fn().mockReturnValue(Buffer.from("encrypted")),
        opaqueHash: vi.fn().mockReturnValue(Buffer.from("hash")),
        randomToken: vi.fn().mockReturnValue("verification-token"),
      } as unknown as CryptoService,
      database as unknown as DatabaseService,
      { hash: vi.fn().mockResolvedValue("password-hash") } as unknown as PasswordService,
      {} as SessionService,
      {} as TotpService,
    );

    await service.register({
      displayName: "Антон Ермолаев",
      email: "client@example.test",
      password: "different-secure-phrase",
      personalDataConsent: true,
      personalDataConsentVersion: REGISTRATION_PERSONAL_DATA_CONSENT_VERSION,
    }, {
      ipAddress: "203.0.113.30",
      userAgent: "Test Browser\u0000 1",
    });

    const consentCall = clientQuery.mock.calls.find((call) => (
      String(call[0]).includes("INSERT INTO app.personal_data_consents")
    ));
    expect(consentCall?.[1]).toEqual([
      userId,
      REGISTRATION_PERSONAL_DATA_CONSENT_VERSION,
      REGISTRATION_PERSONAL_DATA_CONSENT_TEXT,
      "203.0.113.30",
      "Test Browser  1",
    ]);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "auth.registration.requested",
      metadata: { personalDataConsentVersion: REGISTRATION_PERSONAL_DATA_CONSENT_VERSION },
    }), expect.anything());
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
      configStub(),
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

describe("auth admin pending-token lookup", () => {
  const actor = {
    csrfTokenHash: Buffer.alloc(0),
    email: "owner@an30.ru",
    mfaSetupRequired: false,
    mfaVerified: true,
    role: "admin" as const,
    sessionId: "019bf9ea-0d3e-7def-8c9a-0000000000aa",
    userId: "019bf9ea-0d3e-7def-8c9a-0000000000bb",
  };
  const metadata = { ipAddress: "127.0.0.1" };

  it("refuses to run at all when the environment does not allow it, without touching the database", async () => {
    const database = { query: vi.fn() };
    const service = new AuthService(
      configStub({ AUTH_ADMIN_TOKEN_LOOKUP: false }),
      { record: vi.fn() } as unknown as AuditService,
      {} as CryptoService,
      database as unknown as DatabaseService,
      {} as PasswordService,
      {} as SessionService,
      {} as TotpService,
    );

    await expect(service.adminPendingToken({ email: "client@example.test" }, actor, metadata))
      .rejects.toThrow(ForbiddenException);
    expect(database.query).not.toHaveBeenCalled();
  });

  it("reports no pending secret for an email with nothing outstanding", async () => {
    const database = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] }) // app.users
        .mockResolvedValueOnce({ rows: [] }), // app.staff_invitations
    };
    const service = new AuthService(
      configStub({ AUTH_ADMIN_TOKEN_LOOKUP: true }),
      { record: vi.fn() } as unknown as AuditService,
      {} as CryptoService,
      database as unknown as DatabaseService,
      {} as PasswordService,
      {} as SessionService,
      {} as TotpService,
    );

    await expect(service.adminPendingToken({ email: "nobody@example.test" }, actor, metadata))
      .rejects.toThrow(NotFoundException);
  });

  it("returns a verification link for a pending customer and audits who viewed it", async () => {
    const database = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: "user-1", status: "pending_email" }] })
        .mockResolvedValueOnce({
          rows: [{ expires_at: new Date("2026-08-03T00:00:00.000Z"), token_hash: Buffer.from("hash") }],
        })
        .mockResolvedValueOnce({ rows: [{ payload: { encryptedToken: "ciphertext", recipient: "client@example.test" } }] }),
    };
    const audit = { record: vi.fn() };
    const crypto = {
      decrypt: vi.fn().mockReturnValue("raw-verification-token"),
      opaqueHashMatches: vi.fn().mockReturnValue(true),
    };
    const service = new AuthService(
      configStub({ AUTH_ADMIN_TOKEN_LOOKUP: true }),
      audit as unknown as AuditService,
      crypto as unknown as CryptoService,
      database as unknown as DatabaseService,
      {} as PasswordService,
      {} as SessionService,
      {} as TotpService,
    );

    const result = await service.adminPendingToken(
      { email: "client@example.test" },
      actor,
      metadata,
    );

    expect(result).toEqual({
      email: "client@example.test",
      expiresAt: "2026-08-03T00:00:00.000Z",
      link: "https://staging.an30.ru/auth?mode=verify#token=raw-verification-token",
      purpose: "email_verification",
    });
    expect(crypto.decrypt).toHaveBeenCalledWith(expect.any(Buffer), "auth.email.verify:user-1");
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "auth.admin.pending_token_viewed",
      actorRole: "admin",
      actorUserId: actor.userId,
      entityId: "user-1",
      entityType: "user",
    }));
  });

  it("falls back to a pending staff invitation when there is no account yet", async () => {
    const database = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] }) // app.users: no account for this email yet
        .mockResolvedValueOnce({
          rows: [{
            expires_at: new Date("2026-08-05T00:00:00.000Z"),
            id: "invitation-1",
            token_hash: Buffer.from("hash"),
          }],
        })
        .mockResolvedValueOnce({ rows: [{ payload: { encryptedToken: "ciphertext" } }] }),
    };
    const crypto = {
      decrypt: vi.fn().mockReturnValue("raw-invitation-token"),
      opaqueHashMatches: vi.fn().mockReturnValue(true),
    };
    const service = new AuthService(
      configStub({ AUTH_ADMIN_TOKEN_LOOKUP: true }),
      { record: vi.fn() } as unknown as AuditService,
      crypto as unknown as CryptoService,
      database as unknown as DatabaseService,
      {} as PasswordService,
      {} as SessionService,
      {} as TotpService,
    );

    const result = await service.adminPendingToken(
      { email: "new-manager@example.test" },
      actor,
      metadata,
    );

    expect(result).toMatchObject({
      link: "https://staging.an30.ru/auth?mode=staff-accept#token=raw-invitation-token",
      purpose: "staff_invitation",
    });
    expect(crypto.decrypt).toHaveBeenCalledWith(expect.any(Buffer), "auth.staff.invitation:invitation-1");
  });
});
