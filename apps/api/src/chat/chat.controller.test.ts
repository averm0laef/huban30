import { Readable } from "node:stream";

import type { FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/auth-context.js";
import type { RateLimitService } from "../security/rate-limit.service.js";
import type { ChatAssistantService } from "./chat-assistant.service.js";
import { CustomerChatController, GuestChatController } from "./chat.controller.js";
import type { ChatService } from "./chat.service.js";

const ATTACHMENT_ID = "55555555-5555-4555-8555-555555555555";
const USER_ID = "33333333-3333-4333-8333-333333333333";

function replyMock() {
  const reply = {
    header: vi.fn(),
    send: vi.fn(),
  };
  reply.header.mockReturnValue(reply);
  reply.send.mockImplementation((value: unknown) => value);
  return reply;
}

describe("chat attachment controllers", () => {
  it("rate-limits authenticated downloads before sending a length-delimited stream", async () => {
    const content = Readable.from(Buffer.from("safe"));
    const readAttachment = vi.fn().mockResolvedValue({
      byteSize: 4,
      content,
      mimeType: "image/png",
      originalName: "part.png",
    });
    const consume = vi.fn().mockResolvedValue(undefined);
    const controller = new CustomerChatController(
      {} as ChatAssistantService,
      { readAttachment } as unknown as ChatService,
      { consume } as unknown as RateLimitService,
    );
    const authContext = { userId: USER_ID } as AuthContext;
    const reply = replyMock();

    await controller.attachment(
      ATTACHMENT_ID,
      { authContext } as FastifyRequest,
      reply as unknown as FastifyReply,
    );

    expect(consume).toHaveBeenCalledWith("chat-attachment-download", USER_ID, 30, 60);
    expect(consume.mock.invocationCallOrder[0]).toBeLessThan(readAttachment.mock.invocationCallOrder[0]!);
    expect(reply.header).toHaveBeenCalledWith("Content-Length", "4");
    expect(reply.header).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(reply.send).toHaveBeenCalledWith(content);
  });

  it("does not query or open guest attachments after the IP bucket is exhausted", async () => {
    const rateError = new Error("rate limited");
    const consume = vi.fn().mockRejectedValue(rateError);
    const readAttachment = vi.fn();
    const controller = new GuestChatController(
      {} as ChatAssistantService,
      { readAttachment } as unknown as ChatService,
      { consume } as unknown as RateLimitService,
    );

    await expect(controller.attachment(
      ATTACHMENT_ID,
      "guest-token",
      { ip: "203.0.113.9" } as FastifyRequest,
      replyMock() as unknown as FastifyReply,
    )).rejects.toBe(rateError);

    expect(consume).toHaveBeenCalledWith("guest-chat-attachment-download", "203.0.113.9", 30, 60);
    expect(readAttachment).not.toHaveBeenCalled();
  });
});
