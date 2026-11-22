import { createHash, randomUUID } from "node:crypto";

import { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DatabaseService } from "../infrastructure/database.service.js";
import type { RedisService } from "../infrastructure/redis.service.js";
import type { AuditService } from "../security/audit.service.js";
import { CryptoService } from "../security/crypto.service.js";
import type { PasswordService } from "../security/password.service.js";
import type { AuthContext } from "./auth-context.js";
import type { SessionService } from "./session.service.js";
import { SocialAuthService, SOCIAL_FLOW_SECONDS } from "./social-auth.service.js";
import { resolveSocialSubject } from "./social-provider.js";

const metadata = { ipAddress: "127.0.0.1" };
const yandexId = "fixture-yandex-id";

function fixture(approved = true) {
  const config = new ConfigService({
    APP_ORIGIN: "https://shop.example.test",
    LEGAL_DOCUMENTS_APPROVED: approved,
    SESSION_SECRET: "fixture-session-secret-not-used-outside-tests",
    DATA_ENCRYPTION_KEY: "fixture-encryption-key-not-used-outside-tests",
    YANDEX_ID_CLIENT_ID: yandexId,
    VK_ID_CLIENT_ID: "12345678",
  });
  const values = new Map<string, string>();
  const set = vi.fn(async (key: string, value: string) => { values.set(key, value); });
  const getdel = vi.fn(async (key: string) => {
    const value = values.get(key) ?? null;
    values.delete(key);
    return value;
  });
  const query = vi.fn();
  const client = { query };
  const create = vi.fn();
  const audit = { record: vi.fn() };
  const passwords = { verify: vi.fn() };
  const redis = { client: { getdel, set }, ensureConnected: vi.fn() };
  const database = { query, transaction: async <T>(callback: (value: typeof client) => Promise<T>) => callback(client) };
  const social = new SocialAuthService(
    config, audit as unknown as AuditService, new CryptoService(config), database as unknown as DatabaseService,
    passwords as unknown as PasswordService, redis as unknown as RedisService, { create } as unknown as SessionService,
  );
  return { audit, social, query, set, getdel, create, passwords };
}

function customer(): AuthContext {
  return {
    csrfTokenHash: Buffer.alloc(32), email: "buyer@example.test", mfaSetupRequired: false, mfaVerified: true,
    role: "customer", sessionId: randomUUID(), userId: randomUUID(),
  };
}

function successfulYandex() {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ access_token: "fixture-access-token" }))
    .mockResolvedValueOnce(Response.json({ id: "1042", client_id: yandexId, default_email: "ignored@example.test" }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("external customer login", () => {
  it("requires both configuration and approved account documents", async () => {
    const { social, set } = fixture(false);
    expect(social.providers()).toEqual([]);
    await expect(social.begin("yandex")).rejects.toThrow("недоступен");
    expect(set).not.toHaveBeenCalled();
  });

  it("ties the authorization attempt to the browser and consumes it exactly once", async () => {
    const { social, set, query, create } = fixture();
    const fetch = successfulYandex();
    const flow = await social.begin("yandex");
    const url = new URL(flow.authorizationUrl);
    const verifier = JSON.parse(set.mock.calls[0]?.[1] ?? "{}").verifier as string;
    const state = url.searchParams.get("state");
    const callback = { code: "fixture-code", state };
    expect(url.origin).toBe("https://oauth.yandex.ru");
    expect(url.searchParams.get("redirect_uri")).toBe("https://shop.example.test/api/v1/auth/social/yandex/callback");
    expect(url.searchParams.get("code_challenge")).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(set).toHaveBeenCalledWith(expect.any(String), expect.any(String), "EX", SOCIAL_FLOW_SECONDS);
    expect(await social.complete("yandex", callback, undefined, null, metadata)).toEqual({ kind: "failed" });
    expect(await social.complete("vk", callback, flow.browserToken, null, metadata)).toEqual({ kind: "failed" });
    expect(fetch).not.toHaveBeenCalled();
    query.mockResolvedValueOnce({ rows: [] });
    expect(await social.complete("yandex", callback, flow.browserToken, null, metadata)).toEqual({ kind: "unlinked" });
    expect(await social.complete("yandex", callback, flow.browserToken, null, metadata)).toEqual({ kind: "failed" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain("NOT EXISTS");
    expect(query.mock.calls[0]?.[1]).toEqual(["yandex", "1042"]);
    expect(create).not.toHaveBeenCalled();
  });

  it("requires the same active customer session at both ends of account linking", async () => {
    const { social, query, passwords } = fixture();
    const auth = customer();
    const fetch = successfulYandex();
    const flow = await social.begin("yandex", auth);
    const callback = { code: "fixture-code", state: new URL(flow.authorizationUrl).searchParams.get("state") };
    expect(await social.complete("yandex", callback, flow.browserToken, { ...auth, sessionId: randomUUID() }, metadata)).toEqual({ kind: "failed" });
    expect(fetch).not.toHaveBeenCalled();
    await expect(social.confirmPassword({ ...auth, role: "admin" }, "fixture")).rejects.toThrow("только покупателям");
    expect(query).not.toHaveBeenCalled();
    expect(passwords.verify).not.toHaveBeenCalled();
  });

  it("issues the regular local session only for an eligible linked account", async () => {
    const { social, query, create, audit } = fixture();
    successfulYandex();
    const flow = await social.begin("yandex");
    const userId = randomUUID();
    const session = { sessionId: randomUUID(), token: "local", csrfToken: "fixture-csrf", expiresAt: new Date() };
    query.mockResolvedValueOnce({ rows: [{ id: userId }] });
    create.mockResolvedValueOnce(session);
    expect(await social.complete("yandex", {
      code: "fixture-code", state: new URL(flow.authorizationUrl).searchParams.get("state"),
    }, flow.browserToken, null, metadata)).toEqual({ kind: "logged-in", session });
    expect(create).toHaveBeenCalledWith(userId, "127.0.0.1", undefined, false, expect.any(Object));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ metadata: { provider: "yandex" } }), expect.any(Object));
  });

  it("rejects a mismatched VK response before reading the profile", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ state: "wrong", user_id: 742, access_token: "fixture-access-token" }));
    vi.stubGlobal("fetch", fetch);
    await expect(resolveSocialSubject({
      clientId: "12345678", code: "fixture-code", deviceId: "fixture-device", provider: "vk",
      redirectUri: "https://shop.example.test/api/v1/auth/social/vk/callback", state: "correct", verifier: "fixture-verifier",
    })).rejects.toThrow("state mismatch");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URL(fetch.mock.calls[0]?.[0] as URL).searchParams.get("device_id")).toBe("fixture-device");
  });

  it("verifies the VK subject from the server profile and token responses", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ state: "expected", user_id: 742, access_token: "fixture-access-token" }))
      .mockResolvedValueOnce(Response.json({ user: { user_id: "742" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(resolveSocialSubject({
      clientId: "12345678", code: "fixture-code", deviceId: "fixture-device", provider: "vk",
      redirectUri: "https://shop.example.test/api/v1/auth/social/vk/callback", state: "expected", verifier: "fixture-verifier",
    })).resolves.toBe("742");
    expect(new URL(fetch.mock.calls[1]?.[0] as URL).pathname).toBe("/oauth2/user_info");
  });
});
