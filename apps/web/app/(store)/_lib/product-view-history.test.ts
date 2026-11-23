import { afterEach, describe, expect, it, vi } from "vitest";

import { forgetRecordedProductView, recordProductView } from "./product-view-history";

describe("recordProductView", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("sends the opened product to the customer's history once, however often the page asks", async () => {
    const request = vi.fn().mockResolvedValue({ recorded: true });
    await Promise.all([recordProductView("product-1", request), recordProductView("product-1", request)]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("/account/history", { method: "POST", body: { productId: "product-1" } });
    await recordProductView("product-2", request);
    await recordProductView("product-1", request);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("records the same product again on a later visit: after the history was cleared it must come back", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-23T10:00:00Z"));
    const request = vi.fn().mockResolvedValue({ recorded: true });
    await recordProductView("product-4", request);
    vi.setSystemTime(new Date("2026-11-23T10:00:01Z"));
    await recordProductView("product-4", request);
    expect(request).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-11-23T10:00:10Z"));
    await recordProductView("product-4", request);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("records the product opened right after the history was cleared", async () => {
    const request = vi.fn().mockResolvedValue({ recorded: true });
    await recordProductView("product-5", request);
    forgetRecordedProductView();
    await recordProductView("product-5", request);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("keeps the product page working when the history cannot be written, and tries again on the next visit", async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ recorded: true });
    await expect(recordProductView("product-3", request)).resolves.toBeUndefined();
    await recordProductView("product-3", request);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
