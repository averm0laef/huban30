import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import type { FastifyRequest } from "fastify";
import type { WebSocket } from "ws";

import type { AuthContext } from "../auth/auth-context.js";
import { SESSION_COOKIE_NAME, type SessionService } from "../auth/session.service.js";
import type { RateLimitService } from "../security/rate-limit.service.js";
import type { ChatAssistantService } from "./chat-assistant.service.js";
import type { ChatBroadcast, ChatEventBus } from "./chat-event-bus.service.js";
import { ChatRealtimeService } from "./chat-realtime.service.js";
import type { ChatService } from "./chat.service.js";

const APP_ORIGIN = "https://shop.example.test";
const THREAD_A = "11111111-1111-4111-8111-111111111111";
const THREAD_B = "22222222-2222-4222-8222-222222222222";

/** Minimal stand-in for the `ws` WebSocket — enough surface for ChatRealtimeService. */
function fakeSocket() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    OPEN: 1,
    bufferedAmount: 0,
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    ping: vi.fn(),
    on(event: string, handler: (...args: unknown[]) => void) {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
    },
    emit(event: string, ...args: unknown[]) {
      for (const handler of listeners.get(event) ?? []) handler(...args);
    },
  };
}

type FakeSocket = ReturnType<typeof fakeSocket>;

function asWebSocket(socket: FakeSocket): WebSocket {
  return socket as unknown as WebSocket;
}

function fakeRequest(sessionToken: string | undefined): FastifyRequest {
  return {
    cookies: sessionToken ? { [SESSION_COOKIE_NAME]: sessionToken } : {},
    headers: { origin: APP_ORIGIN },
    ip: "203.0.113.9",
  } as unknown as FastifyRequest;
}

function staffAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    csrfTokenHash: Buffer.alloc(32),
    email: "manager@example.test",
    mfaSetupRequired: false,
    mfaVerified: true,
    role: "manager",
    sessionId: "44444444-4444-4444-8444-444444444444",
    userId: "33333333-3333-4333-8333-333333333333",
    ...overrides,
  };
}

function messagesOf(socket: FakeSocket): unknown[] {
  return socket.send.mock.calls.map(([raw]) => JSON.parse(String(raw)));
}

async function buildService(sessionsByToken: Map<string, AuthContext | null>) {
  const config = { getOrThrow: () => APP_ORIGIN } as unknown as ConfigService;
  const assistant = {} as ChatAssistantService;
  const chat = {
    authorize: vi.fn().mockResolvedValue({}),
    history: vi.fn().mockResolvedValue({
      items: [],
      nextSequence: "0",
      thread: { assignedStaffId: null, assignedStaffName: null, status: "open" },
    }),
  } as unknown as ChatService;
  let published: ((event: ChatBroadcast) => void) | undefined;
  const events = {
    subscribe: vi.fn((listener: (event: ChatBroadcast) => void) => {
      published = listener;
      return () => { published = undefined; };
    }),
  } as unknown as ChatEventBus;
  const rateLimit = { consume: vi.fn().mockResolvedValue(undefined) } as unknown as RateLimitService;
  const sessions = {
    resolve: vi.fn((token: string) => Promise.resolve(sessionsByToken.get(token) ?? null)),
  } as unknown as SessionService;

  const service = new ChatRealtimeService(config, assistant, chat, events, rateLimit, sessions);
  service.onModuleInit();
  return {
    chat,
    emit: (event: ChatBroadcast) => published?.(event),
    rateLimit,
    service,
  };
}

async function connectAndSend(
  service: ChatRealtimeService,
  sessionToken: string | undefined,
  message: unknown,
): Promise<FakeSocket> {
  const socket = fakeSocket();
  await service.handle(asWebSocket(socket), fakeRequest(sessionToken));
  socket.emit("message", Buffer.from(JSON.stringify(message)));
  await vi.waitFor(() => {
    expect(socket.send.mock.calls.length).toBeGreaterThan(1);
  });
  return socket;
}

describe("ChatRealtimeService staff queue fan-out", () => {
  it.each(["revoked", "role changed"])("stops delivery when the session is %s", async (change) => {
    const sessions = new Map<string, AuthContext | null>([["staff-token", staffAuth()]]);
    const { emit, service } = await buildService(sessions);
    try {
      const thread = await connectAndSend(service, "staff-token", {
        afterSequence: "0", threadId: THREAD_A, type: "subscribe",
      });
      const queue = await connectAndSend(service, "staff-token", { type: "subscribe.queue" });
      const initialThreadMessages = messagesOf(thread);
      const initialQueueMessages = messagesOf(queue);
      sessions.set("staff-token", change === "revoked" ? null : staffAuth({ role: "customer" }));

      emit({ payload: { type: "message" }, threadId: THREAD_A });

      await vi.waitFor(() => {
        expect(thread.close).toHaveBeenCalledWith(1008, "subscription_unavailable");
        expect(queue.close).toHaveBeenCalledWith(1008, "subscription_unavailable");
      });
      expect(messagesOf(thread)).toEqual(initialThreadMessages);
      expect(messagesOf(queue)).toEqual(initialQueueMessages);
    } finally {
      service.onModuleDestroy();
    }
  });

  it("rechecks access to the subscribed conversation before sending its contents", async () => {
    const { chat, emit, service } = await buildService(new Map());
    try {
      const guestToken = "a".repeat(43);
      const socket = await connectAndSend(service, undefined, {
        afterSequence: "0", guestToken, threadId: THREAD_A, type: "subscribe",
      });
      const initialMessages = messagesOf(socket);
      vi.mocked(chat.authorize).mockRejectedValueOnce(new HttpException("Not found", 404));

      emit({ payload: { type: "message" }, threadId: THREAD_A });

      await vi.waitFor(() => expect(socket.close).toHaveBeenCalledWith(1008, "subscription_unavailable"));
      expect(chat.authorize).toHaveBeenCalledWith(THREAD_A, { guestToken, kind: "guest" });
      expect(messagesOf(socket)).toEqual(initialMessages);
    } finally {
      service.onModuleDestroy();
    }
  });

  it("disconnects a slow socket before growing its outgoing buffer", async () => {
    const { service, emit } = await buildService(new Map([["staff-token", staffAuth()]]));
    try {
      const socket = await connectAndSend(service, "staff-token", { type: "subscribe.queue" });
      const sent = socket.send.mock.calls.length;
      socket.bufferedAmount = 1024 * 1024;
      emit({ payload: { type: "message" }, threadId: THREAD_A });
      expect(socket.terminate).toHaveBeenCalledOnce();
      expect(socket.send).toHaveBeenCalledTimes(sent);
    } finally {
      service.onModuleDestroy();
    }
  });

  it("lets a manager subscribe to the queue and nudges it on a message for ANY thread, without leaking the payload", async () => {
    const managerToken = "manager-session";
    const { emit, service } = await buildService(new Map([[managerToken, staffAuth()]]));

    const queueSocket = await connectAndSend(service, managerToken, { type: "subscribe.queue" });
    expect(messagesOf(queueSocket)).toContainEqual({ type: "queue.subscribed" });

    emit({
      payload: { message: { body: "секретный текст клиента" }, type: "message" },
      threadId: THREAD_A,
    });

    await vi.waitFor(() => {
      expect(messagesOf(queueSocket)).toContainEqual({ threadId: THREAD_A, type: "queue.event" });
    });
    // The nudge never carries the message body — the client must re-fetch
    // through the authorized REST query, same guarantee the queue endpoint
    // itself enforces.
    const raw = queueSocket.send.mock.calls.map(([value]) => String(value)).join("\n");
    expect(raw).not.toContain("секретный текст клиента");
  });

  it("still delivers full detail to a socket that has the exact thread open, unchanged", async () => {
    const managerToken = "manager-session";
    const { emit, service } = await buildService(new Map([[managerToken, staffAuth()]]));

    const threadSocket = await connectAndSend(service, managerToken, {
      afterSequence: "0",
      threadId: THREAD_A,
      type: "subscribe",
    });

    emit({ payload: { message: { body: "Здравствуйте" }, type: "message" }, threadId: THREAD_A });

    await vi.waitFor(() => {
      const raw = threadSocket.send.mock.calls.map(([value]) => String(value)).join("\n");
      expect(raw).toContain("Здравствуйте");
    });
  });

  it("does not nudge a plain per-thread socket about a DIFFERENT thread's event", async () => {
    const managerToken = "manager-session";
    const { emit, service } = await buildService(new Map([[managerToken, staffAuth()]]));

    const threadSocket = await connectAndSend(service, managerToken, {
      afterSequence: "0",
      threadId: THREAD_A,
      type: "subscribe",
    });
    const callsBefore = threadSocket.send.mock.calls.length;

    emit({ payload: { message: { body: "другой чат" }, type: "message" }, threadId: THREAD_B });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(threadSocket.send.mock.calls.length).toBe(callsBefore);
  });

  it("refuses subscribe.queue for a customer session (no chat:manage:any)", async () => {
    const customerToken = "customer-session";
    const { emit, service } = await buildService(
      new Map([[customerToken, staffAuth({ role: "customer" })]]),
    );

    const socket = await connectAndSend(service, customerToken, { type: "subscribe.queue" });
    expect(messagesOf(socket)).toContainEqual(expect.objectContaining({ code: 403, type: "error" }));

    emit({ payload: { message: { body: "x" }, type: "message" }, threadId: THREAD_A });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(messagesOf(socket)).not.toContainEqual(expect.objectContaining({ type: "queue.event" }));
  });

  it("refuses subscribe.queue for an unauthenticated (guest) socket", async () => {
    const { emit, service } = await buildService(new Map());

    const socket = await connectAndSend(service, undefined, { type: "subscribe.queue" });
    expect(messagesOf(socket)).toContainEqual(expect.objectContaining({ code: 403, type: "error" }));

    emit({ payload: { message: { body: "x" }, type: "message" }, threadId: THREAD_A });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(messagesOf(socket)).not.toContainEqual(expect.objectContaining({ type: "queue.event" }));
  });

  it("lets two staff members watching the queue both learn about the same new thread activity", async () => {
    const directorToken = "director-session";
    const managerToken = "manager-session";
    const { emit, service } = await buildService(new Map([
      [directorToken, staffAuth({ role: "director", userId: "director-1" })],
      [managerToken, staffAuth({ role: "manager", userId: "manager-1" })],
    ]));

    const directorSocket = await connectAndSend(service, directorToken, { type: "subscribe.queue" });
    const managerSocket = await connectAndSend(service, managerToken, { type: "subscribe.queue" });

    emit({ payload: { type: "message", message: { body: "Новый гость написал" } }, threadId: THREAD_A });

    await vi.waitFor(() => {
      expect(messagesOf(directorSocket)).toContainEqual({ threadId: THREAD_A, type: "queue.event" });
      expect(messagesOf(managerSocket)).toContainEqual({ threadId: THREAD_A, type: "queue.event" });
    });
  });
});


describe("ChatRealtimeService bounded inbound queue", () => {
  it("applies the connection quota before parsing a frame", async () => {
    const { rateLimit, service } = await buildService(new Map());
    vi.mocked(rateLimit.consume).mockRejectedValueOnce(new HttpException("Too many requests", 429));
    const socket = fakeSocket();
    try {
      await service.handle(asWebSocket(socket), fakeRequest(undefined));
      socket.emit("message", Buffer.from("invalid json"));
      await vi.waitFor(() => expect(socket.close).toHaveBeenCalledWith(1008, "request_rejected"));
      expect(rateLimit.consume).toHaveBeenCalledWith("chat-ws", "203.0.113.9", 60, 60);
      expect(messagesOf(socket)).toContainEqual(expect.objectContaining({ code: 429 }));
    } finally {
      service.onModuleDestroy();
    }
  });

  it("closes an overfull message queue before doing more Redis work", async () => {
    const { rateLimit, service } = await buildService(new Map());
    let resume!: () => void;
    vi.mocked(rateLimit.consume).mockImplementationOnce(() => new Promise<void>((resolve) => {
      resume = resolve;
    }));
    const socket = fakeSocket();
    try {
      await service.handle(asWebSocket(socket), fakeRequest(undefined));
      socket.emit("message", Buffer.from('{"type":"ping"}'));
      await vi.waitFor(() => expect(rateLimit.consume).toHaveBeenCalledOnce());
      for (let index = 0; index < 8; index += 1) {
        socket.emit("message", Buffer.from('{"type":"ping"}'));
      }
      expect(socket.close).toHaveBeenCalledWith(1008, "message_queue_full");
      resume();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(rateLimit.consume).toHaveBeenCalledOnce();
      expect(messagesOf(socket)).not.toContainEqual({ type: "pong" });
    } finally {
      resume?.();
      service.onModuleDestroy();
    }
  });

  it("bounds queued bytes independently of the message count", async () => {
    const { rateLimit, service } = await buildService(new Map());
    let resume!: () => void;
    vi.mocked(rateLimit.consume).mockImplementationOnce(() => new Promise<void>((resolve) => {
      resume = resolve;
    }));
    const socket = fakeSocket();
    const frame = Buffer.from('{"type":"ping"}'.padEnd(16 * 1024, " "));
    try {
      await service.handle(asWebSocket(socket), fakeRequest(undefined));
      socket.emit("message", frame);
      await vi.waitFor(() => expect(rateLimit.consume).toHaveBeenCalledOnce());
      for (let index = 0; index < 4; index += 1) socket.emit("message", frame);
      expect(socket.close).toHaveBeenCalledWith(1008, "message_queue_full");
      resume();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(rateLimit.consume).toHaveBeenCalledOnce();
    } finally {
      resume?.();
      service.onModuleDestroy();
    }
  });

  it("drops the backlog and closes the connection on a rate-limit rejection", async () => {
    const { rateLimit, service } = await buildService(new Map());
    vi.mocked(rateLimit.consume).mockRejectedValue(new HttpException("Too many requests", 429));
    const socket = fakeSocket();
    try {
      await service.handle(asWebSocket(socket), fakeRequest(undefined));
      for (let index = 0; index < 8; index += 1) {
        socket.emit("message", Buffer.from('{"type":"ping"}'));
      }
      await vi.waitFor(() => expect(socket.close).toHaveBeenCalledWith(1008, "request_rejected"));
      expect(rateLimit.consume).toHaveBeenCalledOnce();
      expect(messagesOf(socket).filter((value) => (value as { code?: number }).code === 429)).toHaveLength(1);
      socket.emit("message", Buffer.from('{"type":"ping"}'));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(rateLimit.consume).toHaveBeenCalledOnce();
    } finally {
      service.onModuleDestroy();
    }
  });

  it("does not consume queued messages after the peer closes", async () => {
    const { rateLimit, service } = await buildService(new Map());
    let resume!: () => void;
    vi.mocked(rateLimit.consume).mockImplementationOnce(() => new Promise<void>((resolve) => {
      resume = resolve;
    }));
    const socket = fakeSocket();
    try {
      await service.handle(asWebSocket(socket), fakeRequest(undefined));
      socket.emit("message", Buffer.from('{"type":"ping"}'));
      await vi.waitFor(() => expect(rateLimit.consume).toHaveBeenCalledOnce());
      socket.emit("message", Buffer.from('{"type":"ping"}'));
      socket.emit("close");
      resume();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(rateLimit.consume).toHaveBeenCalledOnce();
      expect(messagesOf(socket)).not.toContainEqual({ type: "pong" });
    } finally {
      resume?.();
      service.onModuleDestroy();
    }
  });
});
