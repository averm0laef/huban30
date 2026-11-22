import { HttpException } from "@nestjs/common";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { HUB_WEBHOOK_MAX_BYTES, registerHubWebhookProtection } from "./webhook-protection.js";

const endpoint = "/api/v1/client-hub/webhooks/example";
const route = "/api/v1/client-hub/webhooks/:id";

describe("hub webhook protection", () => {
  it("applies the IP quota before parsing JSON or calling the webhook", async () => {
    const app = Fastify();
    const consume = vi.fn().mockRejectedValue(new HttpException("Too many requests", 429));
    const handle = vi.fn(() => ({ ok: true }));
    registerHubWebhookProtection(app, { consume });
    app.post(route, handle);
    app.get(route, handle);
    app.get("/health", () => ({ ok: true }));
    try {
      const response = await app.inject({
        method: "POST", url: endpoint, headers: { "content-type": "application/json" }, payload: "invalid json",
      });
      expect(response.statusCode).toBe(429);
      expect(consume).toHaveBeenCalledWith("hub-webhook-ip", "127.0.0.1", 1_200, 60);
      expect((await app.inject(endpoint)).statusCode).toBe(429);
      expect(consume).toHaveBeenCalledWith("hub-challenge-ip", "127.0.0.1", 120, 60);
      expect((await app.inject("/health")).statusCode).toBe(200);
      expect(handle).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("caps the webhook body at the route before calling its handler", async () => {
    const app = Fastify({ bodyLimit: HUB_WEBHOOK_MAX_BYTES * 2 });
    const handle = vi.fn(() => ({ ok: true }));
    registerHubWebhookProtection(app, { consume: vi.fn().mockResolvedValue(undefined) });
    app.post(route, handle);
    try {
      const response = await app.inject({ method: "POST", url: endpoint, payload: { value: "x".repeat(HUB_WEBHOOK_MAX_BYTES) } });
      expect(response.statusCode).toBe(413);
      expect(handle).not.toHaveBeenCalled();
      expect((await app.inject({ method: "POST", url: endpoint, payload: {} })).statusCode).toBe(200);
      expect(handle).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });
});
