import { describe, expect, it } from "vitest";

import { chatLauncherPlacement } from "./chat-launcher";

describe("where the mini-chat is offered", () => {
  it("floats the round button over ordinary storefront pages", () => {
    for (const page of ["/", "/catalog", "/catalog/product/kolodki", "/cart", "/profile", "/chatbot", "/checkouts"]) {
      expect(chatLauncherPlacement(page), page).toBe("floating");
    }
  });

  it("keeps the round button off the checkout form, where the page links to the chat itself", () => {
    expect(chatLauncherPlacement("/checkout")).toBe("inline");
    expect(chatLauncherPlacement("/checkout/success")).toBe("inline");
  });

  it("is off where there is a chat already and in the staff panel", () => {
    for (const page of ["/chat", "/chat/123", "/admin", "/admin/chats"]) {
      expect(chatLauncherPlacement(page), page).toBe("off");
    }
  });
});
