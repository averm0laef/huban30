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
