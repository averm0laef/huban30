import { describe, expect, it } from "vitest";

import { StorefrontApiError } from "../../../_lib/storefront-api-error";
import { loadProduct } from "./product-load";

const product = { id: "p1", slug: "lampa" } as never;

describe("what the product page shows for what the catalogue answered", () => {
  it("the product, or the page «not found»", async () => {
    expect(await loadProduct("lampa", async () => product)).toEqual({ kind: "found", product });
    expect(await loadProduct("net", async () => null)).toEqual({ kind: "missing" });
  });

  it("too many requests from the visitor's address is a page asking to wait, not an error of the site", async () => {
    expect(await loadProduct("lampa", async () => { throw new StorefrontApiError("Слишком много запросов.", 429); })).toEqual({ kind: "busy" });
  });

  it("any other failure still goes to the error page", async () => {
    await expect(loadProduct("lampa", async () => { throw new StorefrontApiError("Каталог временно недоступен.", 503); })).rejects.toThrow("недоступен");
  });
});
