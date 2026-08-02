import { describe, expect, it, vi } from "vitest";

import type { FastifyReply, FastifyRequest } from "fastify";

import type { RateLimitService } from "../security/rate-limit.service.js";
import type { PublicStorefrontService } from "./public-storefront.service.js";
import { PublicStorefrontController } from "./storefront.controller.js";

const OBJECT_ID = "019bf9ea-0d3e-7def-8c9a-000000000003";

describe("PublicStorefrontController", () => {
  it("rate limits banner media before reading bytes", async () => {
    const rateLimit = { consume: vi.fn().mockResolvedValue(undefined) };
    const storefront = {
      media: vi.fn().mockResolvedValue({
        content: Buffer.from("image"),
        etag: '"sha256-test"',
        mimeType: "image/png",
      }),
    };
    const reply = {
      header: vi.fn(() => reply),
      send: vi.fn(),
    };
    const controller = new PublicStorefrontController(
      rateLimit as unknown as RateLimitService,
      storefront as unknown as PublicStorefrontService,
    );

    await controller.media(
      OBJECT_ID,
      { headers: {}, ip: "127.0.0.1" } as FastifyRequest,
      reply as unknown as FastifyReply,
    );

    expect(rateLimit.consume).toHaveBeenCalledWith("public-media", "127.0.0.1", 120, 60);
    expect(rateLimit.consume.mock.invocationCallOrder[0])
      .toBeLessThan(storefront.media.mock.invocationCallOrder[0]!);
  });

  it("returns validators and nosniff headers on a conditional 304 response", async () => {
    const rateLimit = { consume: vi.fn().mockResolvedValue(undefined) };
    const storefront = {
      media: vi.fn().mockResolvedValue({
        content: null,
        etag: '"sha256-test"',
        mimeType: "image/png",
      }),
    };
    const reply = {
      code: vi.fn(() => reply),
      header: vi.fn(() => reply),
      send: vi.fn(),
    };
    const controller = new PublicStorefrontController(
      rateLimit as unknown as RateLimitService,
      storefront as unknown as PublicStorefrontService,
    );

    await controller.media(
      OBJECT_ID,
      { headers: { "if-none-match": '"sha256-test"' }, ip: "127.0.0.1" } as FastifyRequest,
      reply as unknown as FastifyReply,
    );

    expect(reply.header).toHaveBeenCalledWith("Cache-Control", "public, max-age=86400, immutable");
    expect(reply.header).toHaveBeenCalledWith("ETag", '"sha256-test"');
    expect(reply.header).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(reply.code).toHaveBeenCalledWith(304);
    expect(reply.send).toHaveBeenCalledWith();
  });
});
