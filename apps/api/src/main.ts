import "reflect-metadata";

import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import { AppModule } from "./app.module.js";
import { ChatRealtimeService } from "./chat/chat-realtime.service.js";
import { DatabaseService } from "./infrastructure/database.service.js";
import { StructuredLogger } from "./security/structured-logger.js";

async function bootstrap() {
  const adapter = new FastifyAdapter({
    bodyLimit: 10 * 1024 * 1024,
    trustProxy: process.env.TRUST_PROXY === "true",
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: new StructuredLogger(),
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
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
  });
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-origin" },
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
  adapter.getInstance().get("/ws", { websocket: true }, (socket, request) => {
    void realtime.handle(socket, request);
  });

  await app.listen(config.getOrThrow<number>("PORT"), "0.0.0.0");
}

void bootstrap();
