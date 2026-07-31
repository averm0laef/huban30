import "reflect-metadata";

import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import { AppModule } from "./app.module.js";
import { StructuredLogger } from "./security/structured-logger.js";

async function bootstrap() {
  const adapter = new FastifyAdapter({
    trustProxy: process.env.TRUST_PROXY === "true",
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: new StructuredLogger(),
  });
  const config = app.get(ConfigService);

  await app.register(cookie);
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

  await app.listen(config.getOrThrow<number>("PORT"), "0.0.0.0");
}

void bootstrap();
