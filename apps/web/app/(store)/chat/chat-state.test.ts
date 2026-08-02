import { describe, expect, it } from "vitest";

import {
  attachmentSignatureError,
  isChatMessage,
  latestSequence,
  mergeMessages,
  parseStoredGuestThreads,
  reconnectDelay,
  safeDownloadName,
  serializeGuestThreads,
  type ChatMessage,
  type ChatThread,
} from "./chat-state";

const thread: ChatThread = {
  assignedStaffId: null,
  createdAt: "2026-08-02T01:00:00.000Z",
  guestToken: "a".repeat(40),
  id: "019bf9ea-0d3e-7def-9c9a-000000000010",
  lastMessageAt: null,
  orderId: null,
  status: "open",
  subject: "Подбор тормозных колодок",
};

function message(id: string, sequence: string): ChatMessage {
  return {
    attachments: [],
    body: id,
    clientMessageId: null,
    createdAt: "2026-08-02T01:00:00.000Z",
    id,
    messageType: "text",
    replyToId: null,
    senderKind: "staff",
    senderUserId: null,
    sequence,
  };
}

describe("guest chat state", () => {
  it("keeps only valid local guest sessions and never serializes account sessions", () => {
    const stored = serializeGuestThreads([thread, { ...thread, guestToken: undefined, id: "019bf9ea-0d3e-7def-9c9a-000000000011" }]);
    expect(parseStoredGuestThreads(stored)).toEqual([thread]);
    expect(parseStoredGuestThreads("not-json")).toEqual([]);
    expect(parseStoredGuestThreads(JSON.stringify([{ ...thread, guestToken: "short" }]))).toEqual([]);
  });

  it("deduplicates and orders messages with 64-bit sequence values", () => {
    const first = message("019bf9ea-0d3e-7def-9c9a-000000000001", "9223372036854775000");
    const second = message("019bf9ea-0d3e-7def-9c9a-000000000002", "9223372036854775001");
    expect(mergeMessages([second], [first, second]).map((item) => item.id)).toEqual([first.id, second.id]);
  });

  it("bounds reconnect backoff", () => {
    expect(reconnectDelay(0)).toBe(500);
    expect(reconnectDelay(3)).toBe(4_000);
    expect(reconnectDelay(20)).toBe(8_000);
  });

  it("never moves the reconnect cursor backwards", () => {
    expect(latestSequence("42", "41")).toBe("42");
    expect(latestSequence("42", "43")).toBe("43");
    expect(latestSequence("broken", "7")).toBe("7");
  });

  it("rejects malformed realtime messages before BigInt sorting", () => {
    expect(isChatMessage({ ...message("019bf9ea-0d3e-7def-9c9a-000000000003", "3"), sequence: "-1" })).toBe(false);
    expect(isChatMessage(message("019bf9ea-0d3e-7def-9c9a-000000000003", "3"))).toBe(true);
  });

  it("accepts only images whose declared MIME matches their signature", () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(attachmentSignatureError({ size: png.length, type: "image/png" }, png)).toBeNull();
    expect(attachmentSignatureError({ size: png.length, type: "image/jpeg" }, png)).toMatch(/не совпадает/u);
    expect(attachmentSignatureError({ size: png.length, type: "application/pdf" }, png)).toMatch(/JPEG/u);
  });

  it("removes path separators and controls from download names", () => {
    expect(safeDownloadName("../photo\u0000.png")).toBe(".._photo_.png");
    expect(safeDownloadName("../../photo.png")).toBe(".._.._photo.png");
    expect(safeDownloadName("..")).toBe("an30-image");
  });
});
