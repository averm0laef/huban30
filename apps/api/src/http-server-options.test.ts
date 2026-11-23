import { CATALOG_PUBLIC_SLUG_MAX_LENGTH } from "@an30/contracts";
import fastify from "fastify";
import { describe, expect, it } from "vitest";

import { API_HTTP_SERVER_OPTIONS } from "./http-server-options.js";

describe("API HTTP server options", () => {
  it("routes a product slug of the longest length the catalogue allows", async () => {
    const server = fastify(API_HTTP_SERVER_OPTIONS);
    server.get("/api/v1/catalog/products/:idOrSlug", (request) => request.params);
    const slug = "a".repeat(CATALOG_PUBLIC_SLUG_MAX_LENGTH);

    const response = await server.inject({ method: "GET", url: `/api/v1/catalog/products/${slug}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ idOrSlug: slug });
    await server.close();
  });
});
