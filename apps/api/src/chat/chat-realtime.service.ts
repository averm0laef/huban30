import { HttpException, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { FastifyRequest } from "fastify";
import type { RawData, WebSocket } from "ws";

import { ChatClientEventSchema } from "@an30/contracts";

import { SESSION_COOKIE_NAME, SessionService } from "../auth/session.service.js";
import { RateLimitService } from "../security/rate-limit.service.js";
import { ChatEventBus } from "./chat-event-bus.service.js";
import { ChatService } from "./chat.service.js";
import type { ChatIdentity } from "./chat.types.js";

interface ClientState {
  alive: boolean;
  auth: Awaited<ReturnType<SessionService["resolve"]>>;
  identity?: ChatIdentity;
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
      for (const client of this.clients) {
        if (client.threadId === event.threadId && client.socket.readyState === client.socket.OPEN) {
          client.socket.send(serialized);
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
    if (!state.identity || !state.threadId) throw new HttpException("Сначала подпишитесь на чат", 409);
    if (event.type === "message.send") {
      const message = await this.chat.createMessage(state.threadId, {
        body: event.body,
        clientMessageId: event.clientMessageId,
        replyToId: event.replyToId,
      }, state.identity);
      state.socket.send(JSON.stringify({
        clientMessageId: message.clientMessageId,
        messageId: message.id,
        sequence: message.sequence,
        type: "message.ack",
      }));
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
