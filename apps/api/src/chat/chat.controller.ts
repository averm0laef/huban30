import type { Readable } from "node:stream";

import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import { Public } from "../auth/auth.decorators.js";
import { RateLimitService } from "../security/rate-limit.service.js";
import { ChatAssistantService } from "./chat-assistant.service.js";
import { ChatService } from "./chat.service.js";

function sendAttachment(
  reply: FastifyReply,
  value: { byteSize: number; content: Readable; mimeType: string; originalName: string },
) {
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
  };
  const extension = extensions[value.mimeType] ?? "bin";
  return reply
    .header("Cache-Control", "private, no-store")
    .header("Content-Disposition", `attachment; filename="an30-attachment.${extension}"`)
    .header("Content-Length", String(value.byteSize))
    .header("Content-Type", value.mimeType)
    .header("X-Content-Type-Options", "nosniff")
    .send(value.content);
}

@Controller("chat")
export class CustomerChatController {
  constructor(
    private readonly assistant: ChatAssistantService,
    private readonly chat: ChatService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post("threads")
  async create(@Body() body: unknown, @Req() request: FastifyRequest) {
    await this.rateLimit.consume("chat-thread-create", request.authContext!.userId, 10, 3_600);
    return this.chat.createForCustomer(body, request.authContext!);
  }

  @Get("threads")
  list(@Req() request: FastifyRequest) {
    return this.chat.list(request.authContext!);
  }

  @Get("threads/:threadId/messages")
  history(
    @Param("threadId") threadId: string,
    @Query("after") after: string | undefined,
    @Query("before") before: string | undefined,
    @Query("limit") limit: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    return this.chat.history(
      threadId,
      after,
      { auth: request.authContext!, kind: "authenticated" },
      { before, limit },
    );
  }

  @Post("threads/:threadId/messages")
  async message(
    @Param("threadId") threadId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    await this.rateLimit.consume("chat-rest-message", request.authContext!.userId, 60, 60);
    const message = await this.chat.createMessage(
      threadId,
      body,
      { auth: request.authContext!, kind: "authenticated" },
    );
    // Fire-and-forget: ChatAssistantService.respond never rejects (see its
    // own doc comment), and the automated reply — if any — arrives to
    // subscribed clients via the realtime event bus, not this response, so
    // the customer's own message is never delayed by the AI call. Only ever
    // triggered for an actual customer message, never a staff reply sent
    // through this same endpoint (senderKind resolves to "staff" for those).
    if (message.senderKind === "customer") {
      void this.assistant.respond({
        identity: request.authContext!.userId,
        question: message.body ?? "",
        replyToId: message.id,
        threadId,
      });
    }
    return message;
  }

  @Post("threads/:threadId/read/:messageId")
  async read(
    @Param("threadId") threadId: string,
    @Param("messageId") messageId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.rateLimit.consume("chat-rest-read", request.authContext!.userId, 120, 60);
    return this.chat.markRead(
      threadId,
      messageId,
      { auth: request.authContext!, kind: "authenticated" },
    );
  }

  @Post("threads/:threadId/attachments")
  async upload(
    @Param("threadId") threadId: string,
    @Headers("x-client-message-id") clientMessageId: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    await this.rateLimit.consume("chat-attachment-upload", request.authContext!.userId, 20, 3_600);
    return this.chat.uploadAttachment(
      threadId,
      clientMessageId,
      await request.file(),
      { auth: request.authContext!, kind: "authenticated" },
    );
  }

  @Get("attachments/:attachmentId")
  async attachment(
    @Param("attachmentId") attachmentId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    await this.rateLimit.consume("chat-attachment-download", request.authContext!.userId, 30, 60);
    return sendAttachment(
      reply,
      await this.chat.readAttachment(
        attachmentId,
        { auth: request.authContext!, kind: "authenticated" },
      ),
    );
  }
}

@Public()
@Controller("chat/guest")
export class GuestChatController {
  constructor(
    private readonly assistant: ChatAssistantService,
    private readonly chat: ChatService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post("threads")
  async create(
    @Body() body: unknown,
    @Headers("x-guest-order-token") guestOrderToken: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    await this.rateLimit.consume("guest-chat-thread-create", request.ip, 10, 3_600);
    return this.chat.createForGuest(body, guestOrderToken);
  }

  @Get("threads/:threadId/messages")
  history(
    @Param("threadId") threadId: string,
    @Query("after") after: string | undefined,
    @Query("before") before: string | undefined,
    @Query("limit") limit: string | undefined,
    @Headers("x-guest-chat-token") guestToken: string,
  ) {
    return this.chat.history(
      threadId,
      after,
      { guestToken: guestToken ?? "", kind: "guest" },
      { before, limit },
    );
  }

  @Post("threads/:threadId/messages")
  async message(
    @Param("threadId") threadId: string,
    @Body() body: unknown,
    @Headers("x-guest-chat-token") guestToken: string,
    @Req() request: FastifyRequest,
  ) {
    await this.rateLimit.consume("guest-chat-rest-message", request.ip, 60, 60);
    const message = await this.chat.createMessage(
      threadId,
      body,
      { guestToken: guestToken ?? "", kind: "guest" },
    );
    // See the customer controller's `message()` for why this is
    // fire-and-forget and never throws.
    if (message.senderKind === "guest") {
      void this.assistant.respond({
        identity: request.ip,
        question: message.body ?? "",
        replyToId: message.id,
        threadId,
      });
    }
    return message;
  }

  @Post("threads/:threadId/read/:messageId")
  async read(
    @Param("threadId") threadId: string,
    @Param("messageId") messageId: string,
    @Headers("x-guest-chat-token") guestToken: string,
    @Req() request: FastifyRequest,
  ) {
    await this.rateLimit.consume("guest-chat-rest-read", request.ip, 120, 60);
    return this.chat.markRead(threadId, messageId, { guestToken: guestToken ?? "", kind: "guest" });
  }

  @Post("threads/:threadId/attachments")
  async upload(
    @Param("threadId") threadId: string,
    @Headers("x-client-message-id") clientMessageId: string | undefined,
    @Headers("x-guest-chat-token") guestToken: string,
    @Req() request: FastifyRequest,
  ) {
    await this.rateLimit.consume("guest-chat-attachment-upload", request.ip, 20, 3_600);
    return this.chat.uploadAttachment(
      threadId,
      clientMessageId,
      await request.file(),
      { guestToken: guestToken ?? "", kind: "guest" },
    );
  }

  @Get("attachments/:attachmentId")
  async attachment(
    @Param("attachmentId") attachmentId: string,
    @Headers("x-guest-chat-token") guestToken: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    await this.rateLimit.consume("guest-chat-attachment-download", request.ip, 30, 60);
    return sendAttachment(
      reply,
      await this.chat.readAttachment(attachmentId, { guestToken: guestToken ?? "", kind: "guest" }),
    );
  }
}
