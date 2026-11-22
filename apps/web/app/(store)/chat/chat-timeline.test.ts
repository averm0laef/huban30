import { describe, expect, it } from "vitest";

import type { ChatMessage } from "./chat-state";
import { buildTimeline, dayLabel, listTimeLabel, messagePreview } from "./chat-timeline";

const now = new Date(2026, 10, 20, 15, 0);
let sequence = 0;
function message(senderKind: ChatMessage["senderKind"], at: Date, extra: Partial<ChatMessage> = {}): ChatMessage {
  sequence += 1;
  return { attachments: [], body: "текст", clientMessageId: null, createdAt: at.toISOString(), id: `m${sequence}`,
    messageType: senderKind === "system" ? "system" : "text", replyToId: null, senderKind, senderUserId: null, sequence: String(sequence), ...extra };
}
const at = (day: number, hour: number, minute: number) => new Date(2026, 10, day, hour, minute);

describe("messenger timeline", () => {
  it("labels days like a messenger", () => {
    expect(dayLabel(at(20, 9, 0).toISOString(), now)).toBe("Сегодня");
    expect(dayLabel(at(19, 23, 59).toISOString(), now)).toBe("Вчера");
    expect(dayLabel(at(3, 12, 0).toISOString(), now)).toBe("3 ноября");
    expect(dayLabel(new Date(2025, 0, 5).toISOString(), now)).toBe("5 января 2025 г.");
    expect(listTimeLabel(at(19, 10, 0).toISOString(), now)).toBe("вчера");
    expect(listTimeLabel(null, now)).toBe("");
  });

  it("adds a date pill per day and groups consecutive bubbles of one side within five minutes", () => {
    const items = buildTimeline([
      message("staff", at(19, 10, 0)),
      message("customer", at(20, 10, 0)),
      message("customer", at(20, 10, 3)),
      message("customer", at(20, 10, 30)),
      message("staff", at(20, 10, 31)),
    ], { now });
    expect(items.map((item) => item.kind === "date" ? item.label : item.kind === "message" ? `${item.own ? "me" : "shop"}:${item.firstInGroup ? "F" : "-"}${item.lastInGroup ? "L" : "-"}` : "sys"))
      .toEqual(["Вчера", "shop:FL", "Сегодня", "me:F-", "me:-L", "me:FL", "shop:FL"]);
  });

  it("draws system notes as separate pills that break a group", () => {
    const items = buildTimeline([message("staff", at(20, 10, 0)), message("system", at(20, 10, 1)), message("staff", at(20, 10, 2))], { now });
    expect(items.map((item) => item.kind)).toEqual(["date", "message", "system", "message"]);
    expect(items[3]).toMatchObject({ firstInGroup: true });
  });

  it("marks own messages read up to the one the shop has read, by sequence", () => {
    const first = message("guest", at(20, 10, 0)), second = message("guest", at(20, 10, 1)), reply = message("staff", at(20, 10, 2)), third = message("guest", at(20, 10, 3));
    const items = buildTimeline([first, second, reply, third], { lastStaffReadMessageId: second.id, now }).filter((item) => item.kind === "message");
    expect(items.map((item) => item.kind === "message" ? item.delivery : null)).toEqual(["read", "read", null, "sent"]);
    expect(buildTimeline([first], { now }).find((item) => item.kind === "message")).toMatchObject({ delivery: "sent" });
  });

  it("previews text, own messages and attachments in one line", () => {
    expect(messagePreview(message("staff", now, { body: "Есть\n в наличии" }))).toBe("Есть в наличии");
    expect(messagePreview(message("customer", now, { body: "Спасибо" }))).toBe("Вы: Спасибо");
    expect(messagePreview(message("customer", now, { attachments: [{ byteSize: 1, id: "a", mimeType: "image/png", originalName: "a.png" }], body: null, messageType: "attachment" }))).toBe("Вы: Фото");
    expect(messagePreview(undefined)).toBe("");
  });
});
