import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatIntake } from "@an30/contracts";

import {
  GUEST_CHAT_STORAGE_KEY,
  MANAGER_RESPONSE_WINDOW_MS,
  accessFor,
  applyThreadStatus,
  attachmentSignatureError,
  chatThreadCreateBody,
  formatCountdown,
  intakeSubject,
  isChatMessage,
  isChatHistoryWindow,
  isOwnMessage,
  latestSequence,
  loadLatestHistory,
  loadOlderHistory,
  managerJoinState,
  mergeMessages,
  parseStoredGuestThreads,
  reconnectDelay,
  renderedMessageWindow,
  safeDownloadName,
  senderLabel,
  serializeGuestThreads,
  storeGuestThreadStatus,
  unansweredSince,
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

describe("a status the manager set reaches the customer's conversation", () => {
  const other: ChatThread = { ...thread, guestToken: "b".repeat(40), id: "019bf9ea-0d3e-7def-9c9a-000000000020" };

  function stubStorage(initial: Record<string, string>): Map<string, string> {
    const values = new Map(Object.entries(initial));
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
      },
    });
    return values;
  }

  it("closes only the chat the manager closed", () => {
    const next = applyThreadStatus([thread, other], thread.id, "closed");
    expect(next.map((item) => item.status)).toEqual(["closed", "open"]);
  });

  it("reopens a chat the director opened again", () => {
    expect(applyThreadStatus([{ ...thread, status: "closed" }], thread.id, "open")[0]!.status).toBe("open");
  });

  it("returns the same list when nothing changed, so the page does not re-render in a loop", () => {
    const threads = [thread, other];
    expect(applyThreadStatus(threads, thread.id, "open")).toBe(threads);
    expect(applyThreadStatus(threads, "019bf9ea-0d3e-7def-9c9a-000000000099", "closed")).toBe(threads);
  });

  it("remembers the closed chat for the guest's next visit", () => {
    const values = stubStorage({ [GUEST_CHAT_STORAGE_KEY]: serializeGuestThreads([thread, other]) });
    storeGuestThreadStatus(thread.id, "closed");
    const stored = parseStoredGuestThreads(values.get(GUEST_CHAT_STORAGE_KEY) ?? null);
    expect(stored.find((item) => item.id === thread.id)?.status).toBe("closed");
    expect(stored.find((item) => item.id === other.id)?.status).toBe("open");
    // The token that proves the guest owns the chat is kept.
    expect(stored.find((item) => item.id === thread.id)?.guestToken).toBe(thread.guestToken);
  });

  it("does not fail when the browser refuses storage", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => { throw new Error("denied"); }, setItem: () => undefined } });
    expect(() => storeGuestThreadStatus(thread.id, "closed")).not.toThrow();
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

describe("intake questionnaire", () => {
  const baseIntake: ChatIntake = { articleNumber: null, comment: null, intent: "part", vehicle: null };

  it("derives the subject from the intent label alone when no detail was given", () => {
    expect(intakeSubject(baseIntake)).toBe("Нужна деталь по артикулу");
  });

  it("prefers the article number over the vehicle when both are answered", () => {
    expect(intakeSubject({ ...baseIntake, articleNumber: "GDB1330", vehicle: "Toyota Camry 2015" }))
      .toBe("Нужна деталь по артикулу: GDB1330");
  });

  it("falls back to the vehicle when only that was answered", () => {
    expect(intakeSubject({ ...baseIntake, intent: "advice", vehicle: "Toyota Camry 2015" }))
      .toBe("Помочь подобрать деталь: Toyota Camry 2015");
  });

  it("never produces an empty or sub-2-character subject, even for the shortest intent", () => {
    for (const intent of ["part", "advice", "order", "other"] as const) {
      expect(intakeSubject({ ...baseIntake, intent }).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("carries the customer's own answers, untouched, into the thread-create request body", () => {
    const answered: ChatIntake = {
      articleNumber: "GDB1330", comment: "Скрип при торможении", intent: "part", vehicle: "Toyota Camry 2015",
    };
    expect(chatThreadCreateBody(answered)).toEqual({
      intake: answered,
      orderId: null,
      subject: intakeSubject(answered),
    });
  });

  it("still ships the minimal answer — only intent, nothing else filled in — exactly as given", () => {
    expect(chatThreadCreateBody(baseIntake)).toEqual({
      intake: baseIntake,
      orderId: null,
      subject: "Нужна деталь по артикулу",
    });
  });
});

describe("manager-join countdown", () => {
  // 2026-08-02T05:00:00Z is 14:00 in Asia/Chita (STORE_OPEN_HOUR=9,
  // STORE_CLOSE_HOUR=19) — safely inside the shop's working hours.
  const OPEN_NOW = Date.parse("2026-08-02T05:00:00.000Z");
  // 2026-08-02T15:00:00Z is 00:00 in Asia/Chita — well outside working hours.
  const CLOSED_NOW = Date.parse("2026-08-02T15:00:00.000Z");

  function guestMessage(id: string, sequence: string, createdAt: string): ChatMessage {
    return { ...message(id, sequence), createdAt, senderKind: "guest" };
  }

  function staffMessage(id: string, sequence: string, createdAt: string): ChatMessage {
    return { ...message(id, sequence), createdAt, senderKind: "staff" };
  }

  it("has nothing to wait for when every customer message is already answered", () => {
    const messages = [
      guestMessage("019bf9ea-0d3e-7def-9c9a-000000000101", "101", "2026-08-02T04:00:00.000Z"),
      staffMessage("019bf9ea-0d3e-7def-9c9a-000000000102", "102", "2026-08-02T04:05:00.000Z"),
    ];
    expect(unansweredSince(messages)).toBeNull();
    expect(managerJoinState({ assignedStaffId: null, assignedStaffName: null, messages, now: OPEN_NOW, status: "open" }))
      .toEqual({ kind: "none" });
  });

  it("counts down from the oldest unanswered message while the shop is open", () => {
    const sentAt = "2026-08-02T04:57:00.000Z"; // 3 minutes before OPEN_NOW
    const messages = [guestMessage("019bf9ea-0d3e-7def-9c9a-000000000103", "103", sentAt)];
    const state = managerJoinState({ assignedStaffId: null, assignedStaffName: null, messages, now: OPEN_NOW, status: "open" });
    expect(state).toEqual({ kind: "waiting", remainingMs: MANAGER_RESPONSE_WINDOW_MS - 3 * 60_000, sinceIso: sentAt });
    if (state.kind === "waiting") expect(formatCountdown(state.remainingMs)).toBe("7:00");
  });

  it("reports the window as elapsed once ten minutes pass, without inventing an assignment", () => {
    const sentAt = "2026-08-02T04:49:00.000Z"; // 11 minutes before OPEN_NOW
    const messages = [guestMessage("019bf9ea-0d3e-7def-9c9a-000000000104", "104", sentAt)];
    expect(managerJoinState({ assignedStaffId: null, assignedStaffName: null, messages, now: OPEN_NOW, status: "open" }))
      .toEqual({ kind: "elapsed", sinceIso: sentAt });
  });

  it("never promises the ten-minute window outside working hours, however long the message has waited", () => {
    const sentAt = "2026-08-02T14:59:00.000Z"; // 1 minute before CLOSED_NOW — would still be "waiting" if it were open
    const messages = [guestMessage("019bf9ea-0d3e-7def-9c9a-000000000105", "105", sentAt)];
    const state = managerJoinState({ assignedStaffId: null, assignedStaffName: null, messages, now: CLOSED_NOW, status: "open" });
    expect(state.kind).toBe("outOfHours");
    if (state.kind === "outOfHours") {
      expect(state.sinceIso).toBe(sentAt);
      expect(state.openDetail).toMatch(/откроется/u);
    }
  });

  it("reflects a real server-reported assignment over any countdown math, and a closed thread over everything", () => {
    const sentAt = "2026-08-02T04:49:00.000Z";
    const messages = [guestMessage("019bf9ea-0d3e-7def-9c9a-000000000106", "106", sentAt)];
    expect(managerJoinState({ assignedStaffId: "019bf9ea-0d3e-7def-9c9a-0000000009aa", assignedStaffName: "Ирина", messages, now: OPEN_NOW, status: "open" }))
      .toEqual({ kind: "assigned", staffName: "Ирина" });
    expect(managerJoinState({ assignedStaffId: null, assignedStaffName: null, messages, now: OPEN_NOW, status: "closed" }))
      .toEqual({ kind: "closed" });
  });

  it("stops the countdown the moment staff actually reply, before any formal assignment lands", () => {
    const messages = [
      guestMessage("019bf9ea-0d3e-7def-9c9a-000000000107", "107", "2026-08-02T04:55:00.000Z"),
      staffMessage("019bf9ea-0d3e-7def-9c9a-000000000108", "108", "2026-08-02T04:56:00.000Z"),
    ];
    expect(managerJoinState({ assignedStaffId: null, assignedStaffName: null, messages, now: OPEN_NOW, status: "open" }))
      .toEqual({ kind: "none" });
  });

  it("derives the same remaining time from a server timestamp regardless of when the component happens to mount (survives a reload)", () => {
    const sentAt = "2026-08-02T04:57:00.000Z";
    const messages = [guestMessage("019bf9ea-0d3e-7def-9c9a-000000000109", "109", sentAt)];
    // Two independent computations, as if two separate page loads read the
    // same server history at different real moments — neither is seeded
    // from a client-side mount time, so both agree on the same math.
    const firstLoad = managerJoinState({ assignedStaffId: null, assignedStaffName: null, messages, now: OPEN_NOW, status: "open" });
    const reloadTwoMinutesLater = managerJoinState({
      assignedStaffId: null, assignedStaffName: null, messages, now: OPEN_NOW + 2 * 60_000, status: "open",
    });
    expect(firstLoad).toEqual({ kind: "waiting", remainingMs: 7 * 60_000, sinceIso: sentAt });
    expect(reloadTwoMinutesLater).toEqual({ kind: "waiting", remainingMs: 5 * 60_000, sinceIso: sentAt });
  });

  it("keeps the server queue start when only a later history page or a follow-up message is visible", () => {
    const managerWaitSince = "2026-08-02T04:54:00.000Z";
    const messages = [guestMessage("019bf9ea-0d3e-7def-9c9a-000000000110", "110", "2026-08-02T04:59:00.000Z")];
    expect(managerJoinState({ assignedStaffId: null, assignedStaffName: null, managerWaitSince, messages, now: OPEN_NOW, status: "waiting_staff" }))
      .toEqual({ kind: "waiting", remainingMs: 4 * 60_000, sinceIso: managerWaitSince });
    expect(managerJoinState({ assignedStaffId: null, assignedStaffName: null, managerWaitSince, messages: [], now: OPEN_NOW + 60_000, status: "waiting_staff" }))
      .toEqual({ kind: "waiting", remainingMs: 3 * 60_000, sinceIso: managerWaitSince });
  });

  it("honours explicit server absence of a waiting queue and never creates a fake manager on timeout", () => {
    const messages = [guestMessage("019bf9ea-0d3e-7def-9c9a-000000000111", "111", "2026-08-02T04:59:00.000Z")];
    expect(managerJoinState({ assignedStaffId: null, assignedStaffName: null, managerWaitSince: null, messages, now: OPEN_NOW, status: "open" }))
      .toEqual({ kind: "none" });
    expect(managerJoinState({ assignedStaffId: null, assignedStaffName: null, managerWaitSince: "2026-08-02T04:40:00.000Z", messages: [], now: OPEN_NOW, status: "waiting_staff" }))
      .toEqual({ kind: "elapsed", sinceIso: "2026-08-02T04:40:00.000Z" });
  });
});

describe("chat number for the customer", () => {
  it("keeps the number in stored guest sessions and labels it", async () => {
    const { parseStoredGuestThreads: parse, serializeGuestThreads: serialize, threadNumberLabel } = await import("./chat-state");
    const thread = { assignedStaffId: null, createdAt: "2026-08-02T01:00:00.000Z", guestToken: "a".repeat(40), id: "019bf9ea-0d3e-7def-9c9a-000000000077", lastMessageAt: null, orderId: null, publicNumber: 123, status: "open" as const, subject: "Колодки" };
    expect(parse(serialize([thread]))[0]?.publicNumber).toBe(123);
    expect(threadNumberLabel(thread)).toBe("Обращение №000123");
    expect(threadNumberLabel({ publicNumber: null })).toBeNull();
    expect(parse(JSON.stringify([{ ...thread, publicNumber: -1 }]))).toEqual([]);
  });
});
