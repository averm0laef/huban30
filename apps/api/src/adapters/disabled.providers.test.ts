import { describe, expect, it } from "vitest";

import {
  DisabledAiProvider,
  DisabledNotificationProvider,
  DisabledSocialAuthProvider,
  DisabledSupplierProvider,
} from "./disabled.providers.js";

describe("disabled external adapters", () => {
  it("degrades explicitly without calling an external service", async () => {
    await expect(new DisabledNotificationProvider().send({
      body: "test",
      channel: "email",
      recipient: "nobody@example.test",
    })).resolves.toEqual({ accepted: false, provider: "disabled", reason: "disabled" });
    await expect(new DisabledSocialAuthProvider().verify("vk", {})).resolves.toBeNull();
    const ai = new DisabledAiProvider();
    expect(ai.enabled).toBe(false);
    await expect(ai.expandSearchQuery("фильтр")).resolves.toEqual([]);
    const answer = await ai.answerCustomerQuestion({ catalog: [], identity: "1.2.3.4", question: "Есть тормозные колодки?" });
    expect(answer.needsHuman).toBe(true);
    expect(answer.message).not.toHaveLength(0);
    // The disabled provider must never fabricate an answer, a price or a
    // manager who isn't there — it only ever returns this fixed hand-off.
    expect(answer.message).toContain("+7 (924) 474-26-05");
  });

  it("keeps the shop working when the Rossko supplier integration is disabled", async () => {
    const supplier = new DisabledSupplierProvider();
    expect(supplier.enabled).toBe(false);
    await expect(supplier.search("W914/2")).resolves.toEqual({
      message: "Поиск у поставщика отключён",
      parts: [],
      success: false,
    });
  });
});
