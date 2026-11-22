import { Body, Controller, Get, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { RawBodyRequest } from "@nestjs/common";
import { Public, RequirePermissions, SkipCsrf } from "../auth/auth.decorators.js";
import { ClientHubService } from "./client-hub.service.js";

@Controller("client-hub")
export class ClientHubController {
  constructor(private readonly hub: ClientHubService) {}
  @Get("connections") @RequirePermissions("content:manage") connections() { return this.hub.connections(); }
  @Post("connections") @RequirePermissions("settings:manage") saveConnection(@Body() body: unknown,@Req() req: FastifyRequest) { return this.hub.saveConnection(body,req.authContext!); }
  @Post("connections/:id/diagnose") @RequirePermissions("settings:manage") diagnose(@Param("id") id: string,@Req() req: FastifyRequest) { return this.hub.diagnose(id,req.authContext!); }
  @Post("connections/:id/activate") @RequirePermissions("settings:manage") activate(@Param("id") id: string,@Body() body: unknown,@Req() req: FastifyRequest) { return this.hub.activateWebhook(id,body,req.authContext!); }
  @Get("posts") @RequirePermissions("content:manage") posts(@Query() query: unknown) { return this.hub.posts(query); }
  @Post("posts") @RequirePermissions("content:manage") savePost(@Body() body: unknown,@Req() req: FastifyRequest) { return this.hub.savePost(body,req.authContext!); }
  @Post("posts/:id/publish") @RequirePermissions("content:manage") publish(@Param("id") id: string,@Body() body: unknown,@Req() req: FastifyRequest) { return this.hub.publish(id,body,req.authContext!); }
  @Get("conversations") @RequirePermissions("inbox:manage") conversations(@Query() query: unknown) { return this.hub.conversations(query); }
  @Get("conversations/:id/messages") @RequirePermissions("inbox:manage") messages(@Param("id") id: string,@Query() query: unknown) { return this.hub.messages(id,query); }
  @Post("conversations/:id/assign") @RequirePermissions("inbox:manage") assign(@Param("id") id: string,@Body() body: unknown,@Req() req: FastifyRequest) { return this.hub.conversationAction(id,"assign",body,req.authContext!); }
  @Post("conversations/:id/close") @RequirePermissions("inbox:manage") close(@Param("id") id: string,@Body() body: unknown,@Req() req: FastifyRequest) { return this.hub.conversationAction(id,"close",body,req.authContext!); }
  @Post("conversations/:id/release") @RequirePermissions("inbox:manage") release(@Param("id") id: string,@Body() body: unknown,@Req() req: FastifyRequest) { return this.hub.conversationAction(id,"release",body,req.authContext!); }
  @Post("conversations/:id/replies") @RequirePermissions("inbox:manage") reply(@Param("id") id: string,@Body() body: unknown,@Req() req: FastifyRequest) { return this.hub.reply(id,body,req.authContext!); }
  @Get("settings") @RequirePermissions("content:manage") settings() { return this.hub.settings(); }
  @Post("settings") @RequirePermissions("settings:manage") saveSettings(@Body() body: unknown,@Req() req: FastifyRequest) { return this.hub.saveSettings(body,req.authContext!); }
  @Post("jobs/:id/resolve") @RequirePermissions("content:manage") resolve(@Param("id") id: string,@Body() body: unknown,@Req() req: FastifyRequest) { return this.hub.resolveJob(id,body,req.authContext!); }
  @Public() @SkipCsrf() @Get("webhooks/:id")
  async challenge(@Param("id") id: string,@Query() query: Record<string,unknown>,@Res() reply: FastifyReply) {
    return reply.type("text/plain").send(await this.hub.verifyChallenge(id,query));
  }
  @Public() @SkipCsrf() @Post("webhooks/:id")
  async webhook(@Param("id") id: string,@Req() req: RawBodyRequest<FastifyRequest>,@Res() reply: FastifyReply) {
    const result = await this.hub.webhook(id,req.rawBody ?? Buffer.alloc(0),req.headers);
    return reply.code(200).type(typeof result === "string" ? "text/plain" : "application/json").send(result);
  }
}
