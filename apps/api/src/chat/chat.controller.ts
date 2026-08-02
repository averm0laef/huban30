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
import { ChatService } from "./chat.service.js";

function sendAttachment(
  reply: FastifyReply,
  value: { content: Buffer; mimeType: string; originalName: string },
) {
  const extension = value.mimeType === "image/png" ? "png"
    : value.mimeType === "image/webp" ? "webp" : "jpg";
  return reply
    .header("Cache-Control", "private, no-store")
    .header("Content-Disposition", `attachment; filename="an30-attachment.${extension}"`)
    .header("Content-Length", String(value.content.length))
    .header("Content-Type", value.mimeType)
    .header("X-Content-Type-Options", "nosniff")
    .send(value.content);
}

@Controller("chat")
export class CustomerChatController {
  constructor(
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
    @Req() request: FastifyRequest,
  ) {
    return this.chat.history(threadId, after, { auth: request.authContext!, kind: "authenticated" });
  }

  @Post("threads/:threadId/messages")
  async message(
    @Param("threadId") threadId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    await this.rateLimit.consume("chat-rest-message", request.authContext!.userId, 60, 60);
    return this.chat.createMessage(threadId, body, { auth: request.authContext!, kind: "authenticated" });
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
    @Headers("x-guest-chat-token") guestToken: string,
  ) {
    return this.chat.history(threadId, after, { guestToken: guestToken ?? "", kind: "guest" });
  }

  @Post("threads/:threadId/messages")
  async message(
    @Param("threadId") threadId: string,
    @Body() body: unknown,
    @Headers("x-guest-chat-token") guestToken: string,
    @Req() request: FastifyRequest,
  ) {
    await this.rateLimit.consume("guest-chat-rest-message", request.ip, 60, 60);
    return this.chat.createMessage(threadId, body, { guestToken: guestToken ?? "", kind: "guest" });
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
    @Res() reply: FastifyReply,
  ) {
    return sendAttachment(
      reply,
      await this.chat.readAttachment(attachmentId, { guestToken: guestToken ?? "", kind: "guest" }),
    );
  }
}
