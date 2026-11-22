import { HttpException, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { FastifyRequest } from "fastify";
import type { RawData, WebSocket } from "ws";

import { ChatClientEventSchema, ROLE_PERMISSIONS, type Permission } from "@an30/contracts";

import { SESSION_COOKIE_NAME, SessionService } from "../auth/session.service.js";
import { RateLimitService } from "../security/rate-limit.service.js";
import { ChatAssistantService } from "./chat-assistant.service.js";
import { ChatEventBus } from "./chat-event-bus.service.js";
import { ChatService } from "./chat.service.js";
import type { ChatIdentity } from "./chat.types.js";

const MAX_PENDING_MESSAGES = 8;
const MAX_PENDING_MESSAGE_BYTES = 64 * 1024;
const MAX_PENDING_BROADCASTS = 32;
const MAX_OUTBOUND_BYTES = 1024 * 1024;
const MAX_CONNECTIONS = 512;

interface PendingBroadcast {
  identity?: ChatIdentity;
  threadId: string;
  payload: string;
  bytes: number;
}

interface ClientState {
  alive: boolean;
  auth: Awaited<ReturnType<SessionService["resolve"]>>;
  closed: boolean;
  identity?: ChatIdentity;
  /**
   * Staff-only: true once this socket asked for the queue-wide "something
   * changed" nudge (see `subscribe.queue`). Independent of `threadId` — a
   * socket can watch the queue without ever opening one conversation.
   */
  queueSubscribed: boolean;
  pendingBytes: number;
  pendingMessages: number;
  processing: boolean;
  queue: Array<{ byteLength: number; data: RawData }>;
  broadcasts: PendingBroadcast[];
  broadcastBytes: number;
  broadcasting: boolean;
  sessionToken?: string;
  socket: WebSocket;
  subscribeTimer: NodeJS.Timeout;
  threadId?: string;
}

@Injectable()
export class ChatRealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly appOrigin: string;
  private readonly clients = new Set<ClientState>();
  private heartbeat: NodeJS.Timeout | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(
    config: ConfigService,
    private readonly assistant: ChatAssistantService,
    private readonly chat: ChatService,
    private readonly events: ChatEventBus,
    private readonly rateLimit: RateLimitService,
    private readonly sessions: SessionService,
  ) {
    this.appOrigin = config.getOrThrow<string>("APP_ORIGIN");
  }

  onModuleInit(): void {
    this.unsubscribe = this.events.subscribe((event) => {
      const serialized = JSON.stringify(event.payload);
      // Lazily built only if some connected client actually needs it — most
      // fan-out fires while nobody is queue-subscribed.
      let queueNudge: string | undefined;
      for (const client of this.clients) {
        if (client.closed || client.socket.readyState !== client.socket.OPEN) continue;
        if (client.threadId === event.threadId) {
          // Full detail for whoever has this exact conversation open —
          // unchanged from before this fix.
          this.queueBroadcast(client, event.threadId, serialized, client.identity);
        } else if (client.queueSubscribed) {
          // Everyone else watching the staff queue only ever learns that
          // *something* changed on `threadId`, never the message body or
          // thread state itself — the client re-fetches via the normal
          // authorized REST query, so no new data is exposed over this
          // channel.
          queueNudge ??= JSON.stringify({ threadId: event.threadId, type: "queue.event" });
          this.queueBroadcast(client, event.threadId, queueNudge);
        }
      }
    });
    this.heartbeat = setInterval(() => {
      for (const client of this.clients) {
        if (client.closed) continue;
        if (!client.alive) {
          client.socket.terminate();
          continue;
        }
        client.alive = false;
        client.socket.ping();
        if (client.sessionToken) {
          void this.refreshSession(client, false).catch(() => {
            if (client.socket.readyState === client.socket.OPEN) {
              this.closeClient(client, 1008, "session_expired");
            }
          });
        }
      }
    }, 30_000);
    this.heartbeat.unref();
  }

  async handle(socket: WebSocket, request: FastifyRequest): Promise<void> {
    if (request.headers.origin !== this.appOrigin) {
      socket.close(1008, "invalid_origin");
      return;
    }
    if (this.clients.size >= MAX_CONNECTIONS) {
      socket.close(1013, "connection_limit");
      return;
    }
    const sessionToken = request.cookies[SESSION_COOKIE_NAME];
    const state: ClientState = {
      alive: true,
      auth: null,
      broadcasts: [],
      broadcastBytes: 0,
      broadcasting: false,
      closed: false,
      pendingBytes: 0,
      pendingMessages: 0,
      processing: true,
      queue: [],
      queueSubscribed: false,
      sessionToken,
      socket,
      subscribeTimer: setTimeout(() => this.closeClient(state, 1008, "subscribe_timeout"), 10_000),
    };
    this.clients.add(state);
    socket.on("pong", () => { state.alive = true; });
    socket.on("error", () => undefined);
    socket.on("close", () => {
      this.clearClient(state);
      this.clients.delete(state);
    });
    socket.on("message", (data) => {
      if (state.closed || socket.readyState !== socket.OPEN) return;
      const byteLength = Array.isArray(data)
        ? data.reduce((total, chunk) => total + chunk.byteLength, 0)
        : data.byteLength;
      if (state.pendingMessages >= MAX_PENDING_MESSAGES
        || byteLength > MAX_PENDING_MESSAGE_BYTES - state.pendingBytes) {
        this.closeClient(state, 1008, "message_queue_full");
        return;
      }
      state.pendingMessages += 1;
      state.pendingBytes += byteLength;
      state.queue.push({ byteLength, data });
      if (!state.processing) void this.drainQueue(state, request.ip);
    });
    try {
      state.auth = sessionToken ? await this.sessions.resolve(sessionToken) : null;
    } catch {
      this.closeClient(state, 1013, "session_unavailable");
      return;
    }
    if (state.auth && state.auth.role !== "customer" && !state.auth.mfaVerified) {
      this.closeClient(state, 1008, "mfa_required");
      return;
    }
    state.processing = false;
    this.send(state, JSON.stringify({ protocol: 1, type: "hello" }));
    if (!state.closed && state.queue.length > 0) void this.drainQueue(state, request.ip);
  }

  onModuleDestroy(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.unsubscribe?.();
    for (const client of this.clients) this.closeClient(client, 1001, "server_shutdown");
    this.clients.clear();
  }

  private async drainQueue(state: ClientState, ipAddress: string): Promise<void> {
    state.processing = true;
    try {
      while (!state.closed && state.socket.readyState === state.socket.OPEN) {
        const next = state.queue.shift();
        if (!next) break;
        try {
          await this.consume(state, next.data, ipAddress);
        } catch (error: unknown) {
          if (!state.closed) this.sendError(state, error);
          if (error instanceof HttpException && [401, 429, 503].includes(error.getStatus())) {
            this.closeClient(state, 1008, "request_rejected");
          }
        } finally {
          state.pendingMessages = Math.max(0, state.pendingMessages - 1);
          state.pendingBytes = Math.max(0, state.pendingBytes - next.byteLength);
        }
      }
    } finally {
      state.processing = false;
    }
  }

  private clearClient(state: ClientState): void {
    state.closed = true;
    state.queue.length = 0;
    state.pendingMessages = 0;
    state.pendingBytes = 0;
    state.broadcasts.length = 0;
    state.broadcastBytes = 0;
    clearTimeout(state.subscribeTimer);
  }

  private closeClient(state: ClientState, code: number, reason: string): void {
    if (state.closed) return;
    this.clearClient(state);
    state.socket.close(code, reason);
  }

  private send(state: ClientState, payload: string): void {
    if (state.closed || state.socket.readyState !== state.socket.OPEN) return;
    if (state.socket.bufferedAmount + Buffer.byteLength(payload) > MAX_OUTBOUND_BYTES) {
      this.clearClient(state);
      state.socket.terminate();
      return;
    }
    state.socket.send(payload);
  }

  private queueBroadcast(state: ClientState, threadId: string, payload: string, identity?: ChatIdentity): void {
    const bytes = Buffer.byteLength(payload);
    if (state.broadcasts.length >= MAX_PENDING_BROADCASTS
      || state.socket.bufferedAmount + state.broadcastBytes + bytes > MAX_OUTBOUND_BYTES) {
      this.clearClient(state);
      state.socket.terminate();
      return;
    }
    state.broadcasts.push({ bytes, identity, payload, threadId });
    state.broadcastBytes += bytes;
    if (!state.broadcasting) void this.drainBroadcasts(state);
  }

  private async drainBroadcasts(state: ClientState): Promise<void> {
    state.broadcasting = true;
    try {
      while (!state.closed && state.socket.readyState === state.socket.OPEN) {
        const event = state.broadcasts.shift();
        if (!event) break;
        await this.refreshSession(state, false);
        if (state.closed) return;
        if (event.identity && state.identity === event.identity && state.threadId === event.threadId) {
          await this.chat.authorize(event.threadId, event.identity);
          if (state.identity === event.identity) this.send(state, event.payload);
        } else if (!event.identity && state.queueSubscribed) {
          this.send(state, event.payload);
        }
        if (state.closed) return;
        state.broadcastBytes -= event.bytes;
      }
    } catch {
      this.closeClient(state, 1008, "subscription_unavailable");
    } finally {
      state.broadcasting = false;
    }
  }

  private async consume(state: ClientState, raw: RawData, ipAddress: string): Promise<void> {
    await this.rateLimit.consume("chat-ws", state.auth?.userId ?? ipAddress, 60, 60);
    if (state.closed) return;
    const text = this.rawText(raw);
    const parsedJson = this.parseJson(text);
    const parsed = ChatClientEventSchema.safeParse(parsedJson);
    if (!parsed.success) throw new HttpException("Некорректное событие чата", 400);
    const event = parsed.data;
    await this.refreshSession(state, event.type !== "ping");
    if (state.closed) return;

    if (event.type === "ping") {
      this.send(state, JSON.stringify({ type: "pong" }));
      return;
    }
    if (event.type === "subscribe") {
      const identity: ChatIdentity = event.guestToken
        ? { guestToken: event.guestToken, kind: "guest" }
        : state.auth
          ? { auth: state.auth, kind: "authenticated" }
          : (() => { throw new HttpException("Требуется вход или гостевой токен", 401); })();
      const history = await this.chat.history(event.threadId, event.afterSequence, identity);
      if (state.closed) return;
      state.identity = identity;
      state.threadId = event.threadId;
      clearTimeout(state.subscribeTimer);
      this.send(state, JSON.stringify({ ...history, threadId: event.threadId, type: "subscribed" }));
      return;
    }
    if (event.type === "subscribe.queue") {
      // Staff-only nudge channel for the /admin/chats queue list — never
      // available to a guest (no `state.auth` at all) or to a customer
      // (role has no `chat:manage:any`), same permission the REST queue
      // endpoint itself enforces (see StaffController.chats).
      const granted: readonly Permission[] = state.auth ? ROLE_PERMISSIONS[state.auth.role] : [];
      if (!state.auth || !granted.includes("chat:manage:any")) {
        throw new HttpException("Недостаточно прав для очереди чатов", 403);
      }
      state.queueSubscribed = true;
      clearTimeout(state.subscribeTimer);
      this.send(state, JSON.stringify({ type: "queue.subscribed" }));
      return;
    }
    if (!state.identity || !state.threadId) throw new HttpException("Сначала подпишитесь на чат", 409);
    if (event.type === "message.send") {
      // Captured into locals (rather than re-read from `state` after the
      // `await` below) so TypeScript keeps narrowing them past the
      // just-completed undefined check, and so a concurrent subscribe on
      // the same socket cannot change which thread/identity this reply
      // targets partway through.
      const identity = state.identity;
      const threadId = state.threadId;
      const message = await this.chat.createMessage(threadId, {
        body: event.body,
        clientMessageId: event.clientMessageId,
        replyToId: event.replyToId,
      }, identity);
      if (state.closed) return;
      this.send(state, JSON.stringify({
        clientMessageId: message.clientMessageId,
        messageId: message.id,
        sequence: message.sequence,
        type: "message.ack",
      }));
      // Fire-and-forget, same as the REST endpoints: ChatAssistantService
      // never rejects, and any automated reply is delivered to subscribers
      // (including this socket) through the event bus above, not this ack.
      if (message.senderKind === "customer" || message.senderKind === "guest") {
        void this.assistant.respond({
          identity: identity.kind === "authenticated" ? identity.auth.userId : ipAddress,
          question: message.body ?? "",
          replyToId: message.id,
          threadId,
        });
      }
      return;
    }
    await this.chat.markRead(state.threadId, event.messageId, state.identity);
  }

  private async refreshSession(state: ClientState, touch: boolean): Promise<void> {
    if (!state.sessionToken) return;
    const auth = await this.sessions.resolve(state.sessionToken, touch);
    if (!auth || (auth.role !== "customer" && !auth.mfaVerified)) {
      throw new HttpException("Сессия недействительна или истекла", 401);
    }
    if (state.auth && (state.auth.role !== auth.role || state.auth.userId !== auth.userId)) {
      throw new HttpException("Права доступа изменились", 401);
    }
    state.auth = auth;
    if (state.identity?.kind === "authenticated") {
      state.identity.auth = auth;
    }
  }

  private rawText(raw: RawData): string {
    if (typeof raw === "string") return raw;
    if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
    if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
    return raw.toString("utf8");
  }

  private parseJson(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      throw new HttpException("Ожидался JSON", 400);
    }
  }

  private sendError(state: ClientState, error: unknown): void {
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const message = status >= 500
      ? "Внутренняя ошибка чата"
      : error instanceof Error ? error.message : "Ошибка чата";
    this.send(state, JSON.stringify({ code: status, message, type: "error" }));
  }
}
