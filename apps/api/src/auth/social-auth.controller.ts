import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post, Query, Req, Res, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IsString, Length } from "class-validator";
import type { FastifyReply, FastifyRequest } from "fastify";

import { RateLimitService } from "../security/rate-limit.service.js";
import { Public } from "./auth.decorators.js";
import { SESSION_COOKIE_NAME, SessionService } from "./session.service.js";
import { SOCIAL_FLOW_SECONDS, SocialAuthService } from "./social-auth.service.js";
import type { SocialProvider } from "./social-provider.js";

class CurrentPasswordDto {
  @IsString()
  @Length(1, 128)
  currentPassword!: string;
}

function providerFromParam(value: string): SocialProvider {
  if (value === "yandex" || value === "vk") return value;
  throw new NotFoundException();
}

function metadata(request: FastifyRequest) {
  return { ipAddress: request.ip, userAgent: request.headers["user-agent"] };
}

function authContext(request: FastifyRequest) {
  if (!request.authContext) throw new UnauthorizedException("Требуется вход");
  return request.authContext;
}

@Controller("auth/social")
export class SocialAuthController {
  private readonly cookieSecure: boolean;
  private readonly cookieName: string;

  constructor(
    config: ConfigService,
    private readonly social: SocialAuthService,
    private readonly sessions: SessionService,
    private readonly limits: RateLimitService,
  ) {
    this.cookieSecure = config.getOrThrow<boolean>("COOKIE_SECURE");
    this.cookieName = this.cookieSecure ? "__Host-an30_social" : "an30_social";
  }

  @Public()
  @Get("providers")
  providers() {
    return { enabled: this.social.providers() };
  }

  @Public()
  @Post(":provider/login")
  @HttpCode(200)
  async login(@Param("provider") name: string, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const provider = providerFromParam(name);
    await this.limits.consume("social-start", request.ip, 20, 600);
    const flow = await this.social.begin(provider);
    this.setFlowCookie(reply, flow.browserToken);
    return { authorizationUrl: flow.authorizationUrl };
  }

  @Get("connections")
  connections(@Req() request: FastifyRequest) {
    return this.social.connections(authContext(request));
  }

  @Post(":provider/link")
  @HttpCode(200)
  async link(@Param("provider") name: string, @Body() input: CurrentPasswordDto, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const provider = providerFromParam(name);
    const auth = authContext(request);
    await this.limits.consume("social-password", auth.userId, 8, 900);
    await this.social.confirmPassword(auth, input.currentPassword);
    const flow = await this.social.begin(provider, auth);
    this.setFlowCookie(reply, flow.browserToken);
    return { authorizationUrl: flow.authorizationUrl };
  }

  @Delete(":provider/link")
  @HttpCode(204)
  async unlink(@Param("provider") name: string, @Body() input: CurrentPasswordDto, @Req() request: FastifyRequest) {
    const provider = providerFromParam(name);
    const auth = authContext(request);
    await this.limits.consume("social-password", auth.userId, 8, 900);
    await this.social.confirmPassword(auth, input.currentPassword);
    await this.social.disconnect(provider, auth, metadata(request));
  }

  @Public()
  @Get(":provider/callback")
  async callback(@Param("provider") name: string, @Query() query: unknown, @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    const provider = providerFromParam(name);
    reply.header("Referrer-Policy", "no-referrer");
    await this.limits.consume("social-callback", request.ip, 40, 600);
    const sessionToken = request.cookies[SESSION_COOKIE_NAME];
    const auth = sessionToken ? await this.sessions.resolve(sessionToken, false) : null;
    const result = await this.social.complete(provider, query, request.cookies[this.cookieName], auth, metadata(request));
    if (result.kind === "logged-in") {
      this.sessions.setCookie(reply, result.session);
      return reply.redirect("/profile", 303);
    }
    if (result.kind === "linked" || result.kind === "link-conflict" || result.kind === "link-failed") {
      return reply.redirect(`/profile?tab=security&social=${result.kind}`, 303);
    }
    return reply.redirect(`/auth?mode=login&social=${result.kind}`, 303);
  }

  private setFlowCookie(reply: FastifyReply, token: string) {
    reply.setCookie(this.cookieName, token, {
      httpOnly: true,
      maxAge: SOCIAL_FLOW_SECONDS,
      path: "/",
      sameSite: "lax",
      secure: this.cookieSecure,
    });
  }
}
