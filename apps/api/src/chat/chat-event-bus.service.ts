import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Redis } from "ioredis";

import { RedisService } from "../infrastructure/redis.service.js";

export interface ChatBroadcast {
  payload: Record<string, unknown>;
  threadId: string;
}

const CHANNEL = "an30:chat:events:v1";

@Injectable()
export class ChatEventBus implements OnModuleInit, OnModuleDestroy {
  private readonly listeners = new Set<(event: ChatBroadcast) => void>();
  private subscriber: Redis | undefined;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    await this.redis.ensureConnected();
    this.subscriber = this.redis.client.duplicate({ lazyConnect: true, maxRetriesPerRequest: 1 });
    this.subscriber.on("error", () => undefined);
    await this.subscriber.connect();
    await this.subscriber.subscribe(CHANNEL);
    this.subscriber.on("message", (_channel, value) => {
      try {
        const event = JSON.parse(value) as ChatBroadcast;
        if (typeof event.threadId !== "string" || !event.payload || typeof event.payload !== "object") return;
        for (const listener of this.listeners) listener(event);
      } catch {
        // Malformed Redis data is ignored and never reaches connected clients.
      }
    });
  }

  async publish(event: ChatBroadcast): Promise<void> {
    await this.redis.ensureConnected();
    await this.redis.client.publish(CHANNEL, JSON.stringify(event));
  }

  subscribe(listener: (event: ChatBroadcast) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber && this.subscriber.status !== "end") await this.subscriber.quit();
  }
}

