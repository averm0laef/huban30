import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { ClientHubService } from "./client-hub.service.js";
import type { DatabaseService } from "../infrastructure/database.service.js";
import type { CryptoService } from "../security/crypto.service.js";
import type { AuditService } from "../security/audit.service.js";
import type { RateLimitService } from "../security/rate-limit.service.js";

const secret = "webhook-secret-for-tests-only-123456";
const actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" } as never;
function service(environment: string, rows: Record<string, unknown>[] = []) {
  const query = vi.fn(async (sql: string) => ({ rows: sql.startsWith("SELECT * FROM app.hub_connections") ? rows : [], rowCount: 0 }));
  const db = { query, transaction: vi.fn(async (work: (tx: unknown) => unknown) => work({ query })) } as unknown as DatabaseService;
  const crypto = { decrypt: () => JSON.stringify({ token: "test-token-value", webhookSecret: secret }), encrypt: () => Buffer.from("x") } as unknown as CryptoService;
  const config = { getOrThrow: (key: string) => key === "DEPLOYMENT_ENVIRONMENT" ? environment : "https://an30.example" } as unknown as ConfigService;
  const audit = { record: vi.fn() } as unknown as AuditService;
  const limits = { consume: vi.fn() } as unknown as RateLimitService;
  return { hub: new ClientHubService(db, crypto, audit, limits, config), query };
}
const connection = { id: "11111111-1111-4111-8111-111111111111", platform: "max", environment: "development", is_test: false, publish_enabled: false,
  inbox_enabled: true, publish_target: "", inbox_target: "8000001", encrypted_credentials: Buffer.from("x"), version: 1 };

afterEach(() => { delete process.env.HUB_PROVIDER_EMULATOR_URL; });

describe("client hub service", () => {
  const input = { id: connection.id, platform: "max", name: "MAX", isTest: false, inboxEnabled: true, inboxTarget: "8000001", secrets: { token: "test-token-value", webhookSecret: secret } };
  it("keeps live connections out of non-production environments", async () => {
    await expect(service("development").hub.saveConnection(input, actor)).rejects.toBeInstanceOf(BadRequestException);
  });
  it("allows a live connection in development only against the local provider emulator", async () => {
    process.env.HUB_PROVIDER_EMULATOR_URL = "http://127.0.0.1:4901";
    const { hub, query } = service("development");
    await hub.saveConnection(input, actor);
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith("INSERT INTO app.hub_connections"))).toBe(true);
  });
  it("refuses to start with the emulator in production", () => {
    process.env.HUB_PROVIDER_EMULATOR_URL = "http://127.0.0.1:4901";
    expect(() => service("production")).toThrow();
  });
  it("remembers the channel a MAX bot was added to, so the owner can see its ID", async () => {
    const { hub, query } = service("development", [connection]);
    const raw = Buffer.from(JSON.stringify({ update_type: "bot_added", timestamp: 1, chat_id: -70001234, user: { user_id: 5 }, is_channel: true }));
    expect(await hub.webhook(connection.id, raw, { "x-max-bot-api-secret": secret })).toEqual({ ok: true });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO app.hub_events"), [connection.id, "max_chat:-70001234"]);
  });
  it("rejects a MAX event without the subscription secret", async () => {
    const { hub } = service("development", [connection]);
    await expect(hub.webhook(connection.id, Buffer.from("{}"), {})).rejects.toMatchObject({ status: 401 });
  });
  it("asks the owner to finish VK Callback setup only until the first event arrives", async () => {
    const vk = { ...connection, platform: "vk", inbox_target: "42" };
    for (const [last, expected] of [[null, true], [new Date(), false]] as const) {
      const { hub, query } = service("development", [vk]);
      query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith("SELECT * FROM app.hub_connections") ? [vk] : sql.includes("max(received_at)") ? [{ at: last }] : [], rowCount: 0 }));
      vi.spyOn((hub as unknown as { transport: { diagnose: () => Promise<unknown> } }).transport, "diagnose").mockResolvedValue({ checks: [] });
      const result = await hub.diagnose(vk.id, actor);
      expect(result.checks.some(check => check.detail === "vk_no_events_yet")).toBe(expected);
    }
  });
});
