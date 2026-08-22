import { afterEach, describe, expect, it, vi } from "vitest";

import {
  accessFor,
  attachmentSignatureError,
  isChatMessage,
  isChatHistoryWindow,
  isOwnMessage,
  latestSequence,
  loadLatestHistory,
  loadOlderHistory,
  mergeMessages,
  parseStoredGuestThreads,
  reconnectDelay,
  renderedMessageWindow,
  safeDownloadName,
  senderLabel,
  serializeGuestThreads,
  type ChatMessage,
  type ChatThread,
} from "./chat-state";

afterEach(() => vi.unstubAllGlobals());

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

  it("keeps both latest and older rendered history windows bounded", () => {
    const history = Array.from({ length: 220 }, (_, index) => message(
      `019bf9ea-0d3e-7def-9c9a-${String(index + 1).padStart(12, "0")}`,
      String(index + 1),
    ));
    const latest = renderedMessageWindow(history, "latest");
    const older = renderedMessageWindow(history, "older");
    expect(latest).toHaveLength(150);
    expect(latest[0]?.sequence).toBe("71");
    expect(latest.at(-1)?.sequence).toBe("220");
    expect(older).toHaveLength(150);
    expect(older[0]?.sequence).toBe("1");
    expect(older.at(-1)?.sequence).toBe("150");
  });

  it("accepts only strictly ascending newest-window responses", () => {
    const first = message("019bf9ea-0d3e-7def-9c9a-000000000021", "21");
    const second = message("019bf9ea-0d3e-7def-9c9a-000000000022", "22");
    expect(isChatHistoryWindow({ items: [first, second], nextSequence: "22", olderCursor: "21" })).toBe(true);
    expect(isChatHistoryWindow({ items: [second, first], nextSequence: "22", olderCursor: "21" })).toBe(false);
    expect(isChatHistoryWindow({ items: [first], nextSequence: "bad", olderCursor: null })).toBe(false);
  });

  it("requests the newest page first and older pages only after explicit pagination", async () => {
    const item = message("019bf9ea-0d3e-7def-9c9a-000000000031", "31");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      items: [item],
      nextSequence: "31",
      olderCursor: "31",
    }), { headers: { "content-type": "application/json" }, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const access = { guestToken: thread.guestToken!, kind: "guest" as const };

    await loadLatestHistory(thread, access);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/messages?before=latest&limit=50`);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject(expect.any(Headers));
    expect(((fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Headers).get("X-Guest-Chat-Token")).toBe(thread.guestToken);

    await loadOlderHistory(thread, access, "31");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(`/messages?before=31&limit=50`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed realtime messages before BigInt sorting", () => {
    expect(isChatMessage({ ...message("019bf9ea-0d3e-7def-9c9a-000000000003", "3"), sequence: "-1" })).toBe(false);
    expect(isChatMessage(message("019bf9ea-0d3e-7def-9c9a-000000000003", "3"))).toBe(true);
  });

  it("accepts only photos and videos whose declared MIME matches their signature", () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const mp4 = Uint8Array.from([0, 0, 0, 32, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const mov = Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20]);
    const webm = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
    expect(attachmentSignatureError({ size: png.length, type: "image/png" }, png)).toBeNull();
    expect(attachmentSignatureError({ size: png.length, type: "image/jpeg" }, png)).toMatch(/не совпадает/u);
    expect(attachmentSignatureError({ size: mp4.length, type: "video/mp4" }, mp4)).toBeNull();
    expect(attachmentSignatureError({ size: mov.length, type: "video/quicktime" }, mov)).toBeNull();
    expect(attachmentSignatureError({ size: webm.length, type: "video/webm" }, webm)).toBeNull();
    expect(attachmentSignatureError({ size: png.length, type: "application/pdf" }, png)).toMatch(/MP4/u);
    expect(attachmentSignatureError({ size: 15 * 1024 * 1024 + 1, type: "video/mp4" }, mp4)).toMatch(/15 МБ/u);
    expect(attachmentSignatureError({ size: 5 * 1024 * 1024 + 1, type: "image/png" }, png)).toMatch(/5 МБ/u);
  });

  it("removes path separators and controls from download names", () => {
    expect(safeDownloadName("../photo\u0000.png")).toBe(".._photo_.png");
    expect(safeDownloadName("../../photo.png")).toBe(".._.._photo.png");
    expect(safeDownloadName("..")).toBe("an30-file");
  });
});

describe("shared chat channel helpers", () => {
  it("grants customer access unconditionally but only trusts a guest with the thread's own token", () => {
    expect(accessFor({ kind: "customer" }, thread)).toEqual({ kind: "customer" });
    expect(accessFor({ kind: "guest" }, thread)).toEqual({ guestToken: thread.guestToken, kind: "guest" });
    expect(accessFor({ kind: "guest" }, { ...thread, guestToken: undefined })).toBeNull();
    expect(accessFor({ kind: "staff" }, thread)).toBeNull();
    expect(accessFor({ kind: "loading" }, thread)).toBeNull();
  });

  it("only treats customer and guest senders as the viewer's own messages", () => {
    expect(isOwnMessage({ ...message("019bf9ea-0d3e-7def-9c9a-000000000004", "4"), senderKind: "customer" })).toBe(true);
    expect(isOwnMessage({ ...message("019bf9ea-0d3e-7def-9c9a-000000000005", "5"), senderKind: "guest" })).toBe(true);
    expect(isOwnMessage({ ...message("019bf9ea-0d3e-7def-9c9a-000000000006", "6"), senderKind: "staff" })).toBe(false);
    expect(isOwnMessage({ ...message("019bf9ea-0d3e-7def-9c9a-000000000007", "7"), senderKind: "system" })).toBe(false);
  });

  it("labels senders in Russian without ever naming a specific staff member", () => {
    expect(senderLabel("staff")).toBe("АН-30");
    expect(senderLabel("system")).toBe("Система");
    expect(senderLabel("customer")).toBe("Вы");
    expect(senderLabel("guest")).toBe("Вы");
  });
});
