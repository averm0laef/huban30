import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { CatalogPublicController } from "./catalog-public.controller.js";

// Ten visitors from one address (a chaotic run on the demo server; also a dozen customers behind one address of a
// mobile carrier) were told «Каталог не отвечает»: one address was allowed 60 catalogue lists a minute, and one
// visitor opens 10–15. The proxy now stops a flood at the door, so the API's own limit only has to stop what gets
// past it: 240 a minute per address, for every read of the catalogue.
describe("how often one address may read the public catalogue", () => {
  const calls: Array<{ limit: number; scope: string; windowSeconds: number }> = [];
  const limits = { consume: async (scope: string, _identity: string, limit: number, windowSeconds: number) => { calls.push({ limit, scope, windowSeconds }); } };
  const catalog = {
    brands: async () => [], categories: async () => [], categoryTree: async () => [], featured: async () => ({ items: [] }),
    product: async () => ({}), products: async () => ({ items: [], total: 0 }),
  };
  const controller = new CatalogPublicController(catalog as never, limits as never, { record: () => undefined } as never);
  const request = { ip: "203.0.113.7" } as FastifyRequest;

  it("leaves room for a dozen customers behind one address", async () => {
    await controller.products({}, request);
    await controller.product("some-product", request);
    await controller.categories(request);
    await controller.categoryTree(request);
    await controller.brands(request);
    await controller.featured({}, request);
    expect(calls.map((call) => call.scope)).toEqual(["catalog-products", "catalog-product", "catalog-categories", "catalog-categories-tree", "catalog-brands", "catalog-featured"]);
    for (const call of calls) expect(call, call.scope).toMatchObject({ limit: 240, windowSeconds: 60 });
  });
});
