import { describe, expect, it, vi } from "vitest";

import { recordProductView } from "./product-view-history";

describe("recordProductView", () => {
  it("sends the opened product to the customer's history once, however often the page asks", async () => {
    const request = vi.fn().mockResolvedValue({ recorded: true });
    await Promise.all([recordProductView("product-1", request), recordProductView("product-1", request)]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("/account/history", { method: "POST", body: { productId: "product-1" } });
    await recordProductView("product-2", request);
    await recordProductView("product-1", request);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("keeps the product page working when the history cannot be written, and tries again on the next visit", async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ recorded: true });
    await expect(recordProductView("product-3", request)).resolves.toBeUndefined();
    await recordProductView("product-3", request);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
