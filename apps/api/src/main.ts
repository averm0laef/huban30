import "reflect-metadata";

import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { HttpException, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import { AppModule } from "./app.module.js";
import { ChatRealtimeService } from "./chat/chat-realtime.service.js";
import { registerHubWebhookProtection } from "./client-hub/webhook-protection.js";
import { DatabaseService } from "./infrastructure/database.service.js";
import { registerOneCExchangeRawBodyParser } from "./one-c-exchange/one-c-exchange-raw-body-parser.js";
import { StructuredLogger } from "./security/structured-logger.js";
import { isPubliclyCacheableApiRequest } from "./security/http-cache-policy.js";
import { RateLimitService } from "./security/rate-limit.service.js";
import { trustedProxyRanges } from "./security/trusted-proxy.js";

const API_BODY_LIMIT_BYTES = 16 * 1024 * 1024;

async function bootstrap() {
  const adapter = new FastifyAdapter({
    // CommerceML chunks top out at 8 MiB. Chat videos are deliberately
    // capped at 15 MiB below, with a little multipart framing headroom.
    bodyLimit: API_BODY_LIMIT_BYTES,
    requestTimeout: 35_000,
    // Only the configured proxy addresses may supply forwarded identity.
    trustProxy: trustedProxyRanges(process.env),
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: new StructuredLogger(),
    rawBody: true,
  });
  const config = app.get(ConfigService);
  const databaseEnvironment = (await app.get(DatabaseService).query<{ environment: string }>(
    "SELECT environment FROM app.deployment_settings WHERE singleton",
  )).rows[0]?.environment;
  const configuredEnvironment = config.getOrThrow<string>("DEPLOYMENT_ENVIRONMENT");
  if (databaseEnvironment !== configuredEnvironment) {
    throw new Error(
      `Deployment environment mismatch: API=${configuredEnvironment}, database=${databaseEnvironment ?? "missing"}`,
    );
  }

  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
  });
  // CommerceML posts raw chunks, sometimes without Content-Type. The parser
  // rejects its wildcard fallback before reading any non-1C request body.
  registerOneCExchangeRawBodyParser(adapter.getInstance());
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-origin" },
  });
  const rateLimit = app.get(RateLimitService);
  registerHubWebhookProtection(adapter.getInstance(), rateLimit);
  adapter.getInstance().addHook("onSend", (request, reply, payload, done) => {
    if (!isPubliclyCacheableApiRequest(request.method, request.url)) {
      reply.header("Cache-Control", "private, no-store");
      reply.header("Pragma", "no-cache");
      reply.header("Vary", "Cookie, Authorization, X-Guest-Order-Token, X-Guest-Chat-Token");
    }
    done(null, payload);
  });

  app.enableCors({
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    origin: config.getOrThrow<string>("APP_ORIGIN"),
  });
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }));
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle("АН-30 API")
    .setDescription("Автономный API магазина и рабочего места персонала")
    .setVersion("1.0")
    .addCookieAuth("an30_session")
    .build();
  const openApiDocument = SwaggerModule.createDocument(app, swaggerConfig);
  adapter.getInstance().get("/api/v1/openapi.json", async (_request, reply) => {
    await reply.send(openApiDocument);
  });
  const realtime = app.get(ChatRealtimeService);
  adapter.getInstance().get("/ws", {
    websocket: true,
    onRequest: async (request, reply) => {
      if (request.headers.origin !== config.getOrThrow<string>("APP_ORIGIN")) {
        return reply.code(403).send();
      }
      try {
        await rateLimit.consume("chat-ws-connect", request.ip, 60, 60);
      } catch (error) {
        if (error instanceof HttpException) return reply.code(error.getStatus()).send();
        throw error;
      }
    },
  }, (socket, request) => {
    void realtime.handle(socket, request);
  });

  await app.listen(config.getOrThrow<number>("PORT"), config.getOrThrow<string>("API_BIND_HOST"));
}

void bootstrap();
