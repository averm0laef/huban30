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

  it("a former address of a product renamed in 1С leads to its address of today", async () => {
    const moved = async () => { throw new StorefrontApiError("Товар не найден.", 404, "lampa-t4w-24v"); };
    expect(await loadProduct("lampa-t4w", moved)).toEqual({ kind: "moved", slug: "lampa-t4w-24v" });
  });

  it("any other failure still goes to the error page", async () => {
    await expect(loadProduct("lampa", async () => { throw new StorefrontApiError("Каталог временно недоступен.", 503); })).rejects.toThrow("недоступен");
  });
});
