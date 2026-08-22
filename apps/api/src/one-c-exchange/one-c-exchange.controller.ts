// Implements the standard 1С «Обмен с сайтом» (CommerceML 2) handshake: a
// single URL, driven entirely by `type`/`mode` query parameters, that 1С
// itself calls in a fixed sequence -- checkauth, then init, then one POST
// per file chunk, then one or more GET import polls. See the protocol notes
// in packages/contracts/src/one-c-exchange.ts and
// docs/ONE_C_INTEGRATION.md. Every reply is plain text (never JSON): 1С's
// exchange module parses the response body itself, line by line, and does
// not look at HTTP status text or a JSON envelope.
//
// This is deliberately a thin dispatcher. Credential/CIDR verification lives
// in OneCIntegrationService (shared with the JSON machine endpoint --
// catalog/catalog-import.controller.ts), chunk assembly lives in
// OneCExchangeTempStorageService, and applying a parsed file lives in
// OneCExchangeService. The controller's own job is just the wire protocol:
// which mode does what, and in what plain-text shape.
import { Controller, Get, Post, Query, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { FastifyReply, FastifyRequest } from "fastify";

import { OneCExchangeQuerySchema, type OneCExchangeQuery } from "@an30/contracts";

import { OneCIntegrationService } from "../catalog/one-c-integration.service.js";
import { Public, SkipCsrf } from "../auth/auth.decorators.js";
import { RateLimitService } from "../security/rate-limit.service.js";
import { OneCExchangeSessionService } from "./one-c-exchange-session.service.js";
import { OneCExchangeTempStorageService } from "./one-c-exchange-temp-storage.service.js";
import { OneCExchangeService } from "./one-c-exchange.service.js";

// 1С only ever asks for this once per session and immediately reuses it for
// every request that follows, so a brute-force attempt looks like many
// checkauth calls in a short window -- a tighter budget than the steady
// stream of init/file/import polls a legitimate 40,000-SKU sync produces.
const AUTH_RATE_LIMIT = { limit: 30, windowSeconds: 60 };
// A chunked sync of 30-40k SKUs can mean well over a hundred file/import
// round trips in a burst; generous on purpose so a real sync never trips it,
// while still bounding a runaway or hostile client.
const REQUEST_RATE_LIMIT = { limit: 1_200, windowSeconds: 60 };

// Comfortably under Fastify's global 10 MiB body limit (see main.ts): each
// mode=file POST is one chunk, never the whole assembled file, so this only
// needs headroom for one chunk plus request overhead, not the full catalog.
const FILE_CHUNK_LIMIT_BYTES = 8 * 1024 * 1024;

function detectFileKind(filename: string): "catalog" | "offers" | null {
  const base = filename.split("/").pop()?.toLowerCase() ?? "";
  if (base.startsWith("import")) return "catalog";
  if (base.startsWith("offers")) return "offers";
  return null;
}

@Public()
@SkipCsrf() // 1С cannot obtain or send a CSRF token; Basic auth + the session cookie below + the CIDR allowlist are this endpoint's protection instead.
@Controller("integrations/1c/exchange")
export class OneCExchangeController {
  private readonly cookieSecure: boolean;

  constructor(
    config: ConfigService,
    private readonly exchange: OneCExchangeService,
    private readonly integration: OneCIntegrationService,
    private readonly rateLimit: RateLimitService,
    private readonly session: OneCExchangeSessionService,
    private readonly tempStorage: OneCExchangeTempStorageService,
  ) {
    this.cookieSecure = config.get<boolean>("COOKIE_SECURE") ?? true;
  }

  @Get()
  async get(
    @Query() query: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    return this.handle(query, undefined, request, reply);
  }

  @Post()
  async post(
    @Query() query: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    // The wildcard content-type parser registered in main.ts hands every
    // non-JSON, non-multipart body (which is all 1С ever sends here) through
    // as a raw Buffer -- one chunk, never buffered beyond this one request.
    const body = request.body;
    return this.handle(query, body instanceof Buffer ? body : Buffer.alloc(0), request, reply);
  }

  private async handle(
    rawQuery: unknown,
    body: Buffer | undefined,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<string> {
    reply.type("text/plain; charset=utf-8");
    const parsedQuery = OneCExchangeQuerySchema.safeParse(rawQuery);
    if (!parsedQuery.success) return "failure\nНекорректные параметры запроса";
    const query = parsedQuery.data;
    // "sale" (orders pushed back to 1С) is a different exchange this task
    // does not implement; fail closed rather than silently no-op.
    if (query.type !== "catalog") return "failure\nПоддерживается только type=catalog";

    try {
      await this.rateLimit.consume("one-c-exchange-request", request.ip, REQUEST_RATE_LIMIT.limit, REQUEST_RATE_LIMIT.windowSeconds);
    } catch {
      reply.status(429);
      return "failure\nСлишком много запросов";
    }

    if (query.mode === "checkauth") return this.checkauth(request, reply);

    const authorized = await this.session.verify(request.cookies[this.session.cookieName], request.ip)
      || await this.integration.verifyBasicAuth(request.headers.authorization, request.ip);
    if (!authorized) {
      reply.status(401);
      reply.header("WWW-Authenticate", 'Basic realm="AN30 1C Exchange", charset="UTF-8"');
      return "failure\nАутентификация не пройдена";
    }

    if (query.mode === "init") return this.init();
    if (query.mode === "file") return this.file(query, body ?? Buffer.alloc(0));
    if (query.mode === "import") return this.doImport(query);
    return "failure\nНеизвестный режим обмена";
  }

  private async checkauth(request: FastifyRequest, reply: FastifyReply): Promise<string> {
    try {
      await this.rateLimit.consume("one-c-exchange-auth", request.ip, AUTH_RATE_LIMIT.limit, AUTH_RATE_LIMIT.windowSeconds);
    } catch {
      reply.status(429);
      return "failure\nСлишком много попыток входа";
    }

    const accepted = await this.integration.verifyBasicAuth(request.headers.authorization, request.ip);
    await this.integration.recordRequest({
      details: { outcome: accepted ? "accepted" : "rejected" },
      ipAddress: request.ip,
      operation: "exchange_checkauth",
      statusCode: accepted ? 200 : 401,
      succeeded: accepted,
    });
    if (!accepted) {
      reply.status(401);
      reply.header("WWW-Authenticate", 'Basic realm="AN30 1C Exchange", charset="UTF-8"');
      return "failure";
    }

    const token = await this.session.issue(request.ip);
    // 1С reads the name/value back out of the body itself and resends them
    // as a literal Cookie header -- this Set-Cookie is a courtesy for
    // anything that also behaves like a browser, not the actual mechanism.
    reply.setCookie(this.session.cookieName, token, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: this.cookieSecure,
    });
    return `success\n${this.session.cookieName}\n${token}`;
  }

  private async init(): Promise<string> {
    // mode=init always starts a fresh exchange session: any files left over
    // from an interrupted previous run must not silently resurface in this one.
    await this.tempStorage.purgeAll();
    return `zip=no\nfile_limit=${FILE_CHUNK_LIMIT_BYTES}`;
  }

  private async file(query: OneCExchangeQuery, body: Buffer): Promise<string> {
    if (!query.filename) return "failure\nНе указано имя файла";
    try {
      await this.tempStorage.appendChunk(query.filename, body);
      return "success";
    } catch (error) {
      return `failure\n${error instanceof Error ? error.message : "Не удалось сохранить файл"}`;
    }
  }

  private async doImport(query: OneCExchangeQuery): Promise<string> {
    if (!query.filename) return "failure\nНе указано имя файла";
    const kind = detectFileKind(query.filename);
    if (!kind) return "failure\nНеизвестный тип файла обмена (ожидается import*.xml или offers*.xml)";

    let assembled: Buffer;
    let checksum: Buffer;
    try {
      assembled = await this.tempStorage.readAssembled(query.filename);
      checksum = await this.tempStorage.checksum(query.filename);
    } catch {
      return "failure\nФайл не найден на сервере; повторите mode=file";
    }

    const result = await this.exchange.processImport({ assembled, checksum, filename: query.filename, kind });
    if (result.kind === "success") {
      // The assembled file has fully landed in the database; nothing further
      // ever reads it back, so free the disk space now rather than waiting
      // for the next mode=init.
      await this.tempStorage.remove(query.filename);
      return "success";
    }
    if (result.kind === "progress") return `progress\n${result.message}`;
    return `failure\n${result.reason}`;
  }
}
