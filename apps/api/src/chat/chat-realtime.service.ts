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

interface ClientState {
  alive: boolean;
  auth: Awaited<ReturnType<SessionService["resolve"]>>;
  identity?: ChatIdentity;
  /**
   * Staff-only: true once this socket asked for the queue-wide "something
   * changed" nudge (see `subscribe.queue`). Independent of `threadId` — a
   * socket can watch the queue without ever opening one conversation.
   */
  queueSubscribed: boolean;
  queue: Promise<void>;
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
        if (client.socket.readyState !== client.socket.OPEN) continue;
        if (client.threadId === event.threadId) {
          // Full detail for whoever has this exact conversation open —
          // unchanged from before this fix.
          client.socket.send(serialized);
        } else if (client.queueSubscribed) {
          // Everyone else watching the staff queue only ever learns that
          // *something* changed on `threadId`, never the message body or
          // thread state itself — the client re-fetches via the normal
          // authorized REST query, so no new data is exposed over this
          // channel.
          queueNudge ??= JSON.stringify({ threadId: event.threadId, type: "queue.event" });
          client.socket.send(queueNudge);
        }
      }
    });
    this.heartbeat = setInterval(() => {
      for (const client of this.clients) {
        if (!client.alive) {
          client.socket.terminate();
          continue;
        }
        client.alive = false;
        client.socket.ping();
        if (client.sessionToken) {
          void this.refreshSession(client, false).catch(() => {
            if (client.socket.readyState === client.socket.OPEN) {
              client.socket.close(1008, "session_expired");
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
    const sessionToken = request.cookies[SESSION_COOKIE_NAME];
    const auth = sessionToken ? await this.sessions.resolve(sessionToken) : null;
    if (auth && auth.role !== "customer" && !auth.mfaVerified) {
      socket.close(1008, "mfa_required");
      return;
    }
    const state: ClientState = {
      alive: true,
      auth,
      queue: Promise.resolve(),
      queueSubscribed: false,
      sessionToken,
      socket,
      subscribeTimer: setTimeout(() => socket.close(1008, "subscribe_timeout"), 10_000),
    };
    this.clients.add(state);
    socket.on("pong", () => { state.alive = true; });
    socket.on("error", () => undefined);
    socket.on("close", () => {
      clearTimeout(state.subscribeTimer);
      this.clients.delete(state);
    });
    socket.on("message", (data) => {
      state.queue = state.queue
        .then(() => this.consume(state, data, request.ip))
        .catch((error: unknown) => this.sendError(state.socket, error));
    });
    socket.send(JSON.stringify({ protocol: 1, type: "hello" }));
  }

  onModuleDestroy(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.unsubscribe?.();
    for (const client of this.clients) client.socket.close(1001, "server_shutdown");
    this.clients.clear();
  }

  private async consume(state: ClientState, raw: RawData, ipAddress: string): Promise<void> {
    const text = this.rawText(raw);
    const parsedJson = this.parseJson(text);
    const parsed = ChatClientEventSchema.safeParse(parsedJson);
    if (!parsed.success) throw new HttpException("Некорректное событие чата", 400);
    const event = parsed.data;
    await this.refreshSession(state, event.type !== "ping");
    const identityKey = state.auth?.userId ?? ipAddress;
    await this.rateLimit.consume("chat-ws", identityKey, 60, 60);

    if (event.type === "ping") {
      state.socket.send(JSON.stringify({ type: "pong" }));
      return;
    }
    if (event.type === "subscribe") {
      const identity: ChatIdentity = event.guestToken
        ? { guestToken: event.guestToken, kind: "guest" }
        : state.auth
          ? { auth: state.auth, kind: "authenticated" }
          : (() => { throw new HttpException("Требуется вход или гостевой токен", 401); })();
      const history = await this.chat.history(event.threadId, event.afterSequence, identity);
      state.identity = identity;
      state.threadId = event.threadId;
      clearTimeout(state.subscribeTimer);
      state.socket.send(JSON.stringify({ ...history, threadId: event.threadId, type: "subscribed" }));
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
      state.socket.send(JSON.stringify({ type: "queue.subscribed" }));
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
      state.socket.send(JSON.stringify({
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
    state.auth = auth;
    if (state.identity?.kind === "authenticated") {
      state.identity = { auth, kind: "authenticated" };
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

  private sendError(socket: WebSocket, error: unknown): void {
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const message = status >= 500
      ? "Внутренняя ошибка чата"
      : error instanceof Error ? error.message : "Ошибка чата";
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ code: status, message, type: "error" }));
    }
  }
}
