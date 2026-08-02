import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { ChatEventBus } from "./chat-event-bus.service.js";
import { CustomerChatController, GuestChatController } from "./chat.controller.js";
import { ChatRealtimeService } from "./chat-realtime.service.js";
import { ChatService } from "./chat.service.js";

@Module({
  controllers: [CustomerChatController, GuestChatController],
  exports: [ChatRealtimeService],
  imports: [AuthModule],
  providers: [ChatEventBus, ChatRealtimeService, ChatService],
})
export class ChatModule {}

