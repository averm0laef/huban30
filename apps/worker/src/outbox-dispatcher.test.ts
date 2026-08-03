import { describe, expect, it } from "vitest";

import { buildAuthEmailTemplate, buildStaffAlert } from "./outbox-dispatcher.js";

const THREAD_ID = "019bf9ea-0d3e-7def-8c9a-000000000001";
const REQUEST_ID = "019bf9ea-0d3e-7def-8c9a-000000000002";

describe("staff outbox alerts", () => {
  it("creates same-origin staff links without putting contact PII in the alert", () => {
    expect(buildStaffAlert(
      "contact.staff.notify",
      { requestId: REQUEST_ID, source: "expert_help" },
      "https://an30.ru",
    )).toBe(`Запрос эксперту в АН-30. https://an30.ru/admin/requests?request=${REQUEST_ID}`);
  });

  it("keeps existing chat alerts and rejects unknown payload fields", () => {
    expect(buildStaffAlert(
      "chat.staff.notify",
      { messageId: THREAD_ID, senderKind: "guest", threadId: THREAD_ID },
      "https://an30.ru",
    )).toContain(`/admin/chats/${THREAD_ID}`);

    expect(() => buildStaffAlert(
      "contact.staff.notify",
      { email: "secret@example.test", requestId: REQUEST_ID, source: "contacts" },
      "https://an30.ru",
    )).toThrow();
  });

  it("labels an AI-assistant hand-off distinctly from a customer/guest message", () => {
    const alert = buildStaffAlert(
      "chat.staff.notify",
      { messageId: THREAD_ID, senderKind: "system", threadId: THREAD_ID },
      "https://an30.ru",
    );
    expect(alert).toContain("Автоматический ассистент");
    expect(alert).toContain(`/admin/chats/${THREAD_ID}`);
  });
});

describe("auth email links", () => {
  const token = "secret-token-that-must-not-reach-http-logs";

  it.each([
    ["auth.email.verify", "verify"],
    ["auth.password.reset", "reset"],
    ["auth.staff.invitation", "staff-accept"],
  ])("routes %s through the real auth screen", (topic, mode) => {
    const template = buildAuthEmailTemplate(topic, token, "https://an30.ru");
    const link = template.text.match(/https:\/\/\S+/u)?.[0];
    expect(link).toBeDefined();
    const url = new URL(link!);
    expect(url.pathname).toBe("/auth");
    expect(url.searchParams.get("mode")).toBe(mode);
    expect(url.searchParams.has("token")).toBe(false);
    expect(new URLSearchParams(url.hash.slice(1)).get("token")).toBe(token);
  });

  it("rejects an unknown secret email topic", () => {
    expect(() => buildAuthEmailTemplate("auth.unknown", token, "https://an30.ru")).toThrow(
      "unsupported_auth_topic",
    );
  });
});
