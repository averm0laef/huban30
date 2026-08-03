import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { CatalogModule } from "../catalog/catalog.module.js";
import { ChatAssistantService } from "./chat-assistant.service.js";
import { ChatEventBus } from "./chat-event-bus.service.js";
import { CustomerChatController, GuestChatController } from "./chat.controller.js";
import { ChatRealtimeService } from "./chat-realtime.service.js";
import { ChatService } from "./chat.service.js";

@Module({
  controllers: [CustomerChatController, GuestChatController],
  exports: [ChatEventBus, ChatRealtimeService],
  imports: [AuthModule, CatalogModule],
  providers: [ChatAssistantService, ChatEventBus, ChatRealtimeService, ChatService],
})
export class ChatModule {}

