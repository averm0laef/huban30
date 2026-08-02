import { describe, expect, it } from "vitest";

import {
  DisabledAiProvider,
  DisabledNotificationProvider,
  DisabledSocialAuthProvider,
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
  });
});
