import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(config.getOrThrow<string>("REDIS_URL"), {
      connectTimeout: 2_000,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    this.client.on("error", () => undefined);
  }

  async ensureConnected(): Promise<void> {
    if (this.client.status === "wait") await this.client.connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status !== "end") await this.client.quit();
  }
}
