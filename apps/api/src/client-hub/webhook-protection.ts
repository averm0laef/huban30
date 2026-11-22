import { HttpException } from "@nestjs/common";
import type { FastifyInstance } from "fastify";

import type { RateLimitService } from "../security/rate-limit.service.js";

export const HUB_WEBHOOK_MAX_BYTES = 512 * 1024;
const WEBHOOK_ROUTE = "/api/v1/client-hub/webhooks/:id";

export function registerHubWebhookProtection(server: FastifyInstance, rateLimit: Pick<RateLimitService, "consume">): void {
  server.addHook("onRoute", (route) => {
    if (route.url === WEBHOOK_ROUTE && route.method === "POST") {
      route.bodyLimit = HUB_WEBHOOK_MAX_BYTES;
    }
  });
  server.addHook("onRequest", async (request, reply) => {
    if (request.routeOptions.url !== WEBHOOK_ROUTE || request.method === "OPTIONS") return;
    // Reject excess traffic before reading the body, looking up the connection
    // or decrypting its credentials. Verified events have a separate quota.
    const delivery = request.method === "POST";
    try {
      await rateLimit.consume(delivery ? "hub-webhook-ip" : "hub-challenge-ip", request.ip, delivery ? 1_200 : 120, 60);
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      await reply.code(error.getStatus()).send(error.getResponse());
    }
  });
}
