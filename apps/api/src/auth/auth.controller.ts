import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";

import { AllowPendingMfa, Public, RequirePermissions } from "./auth.decorators.js";
import {
  AcceptStaffInvitationDto,
  ForgotPasswordDto,
  InviteStaffDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  TotpCodeDto,
  VerifyEmailDto,
} from "./auth.dto.js";
import { AuthService } from "./auth.service.js";
import { RateLimitService } from "../security/rate-limit.service.js";
import { SessionService } from "./session.service.js";

function requestMetadata(request: FastifyRequest) {
  const userAgent = request.headers["user-agent"];
  return {
    ipAddress: request.ip,
    userAgent: typeof userAgent === "string" ? userAgent : undefined,
  };
}

@ApiTags("auth")
@ApiCookieAuth("an30_session")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly rateLimit: RateLimitService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Post("register")
  @HttpCode(202)
  async register(@Body() input: RegisterDto, @Req() request: FastifyRequest) {
    await Promise.all([
      this.rateLimit.consume("register-ip", request.ip, 10, 3_600),
      this.rateLimit.consume("register-email", input.email, 4, 3_600),
    ]);
    return this.auth.register(input, requestMetadata(request));
  }

  @Public()
  @Post("email/verify")
  async verifyEmail(@Body() input: VerifyEmailDto, @Req() request: FastifyRequest) {
    await this.rateLimit.consume("verify-email-ip", request.ip, 20, 900);
    return this.auth.verifyEmail(input, requestMetadata(request));
  }

  @Public()
  @Post("login")
  async login(
    @Body() input: LoginDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.rateLimit.consume("login-ip", request.ip, 20, 900);
    await this.rateLimit.consume("login-email", input.email, 8, 900);
    const result = await this.auth.login(input, requestMetadata(request));
    this.sessions.setCookie(reply, result.session);
    return result.body;
  }

  @AllowPendingMfa()
  @Get("session")
  session(@Req() request: FastifyRequest) {
    const auth = request.authContext!;
    return {
      email: auth.email,
      mfaSetupRequired: auth.mfaSetupRequired,
      mfaVerified: auth.mfaVerified,
      role: auth.role,
      userId: auth.userId,
    };
  }

  @AllowPendingMfa()
  @Post("logout")
  @HttpCode(204)
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(request.authContext!, requestMetadata(request));
    this.sessions.clearCookie(reply);
  }

  @Public()
  @Post("password/forgot")
  @HttpCode(202)
  async forgotPassword(@Body() input: ForgotPasswordDto, @Req() request: FastifyRequest) {
    await Promise.all([
      this.rateLimit.consume("forgot-ip", request.ip, 10, 3_600),
      this.rateLimit.consume("forgot-email", input.email, 4, 3_600),
    ]);
    return this.auth.forgotPassword(input.email, requestMetadata(request));
  }

  @Public()
  @Post("password/reset")
  async resetPassword(@Body() input: ResetPasswordDto, @Req() request: FastifyRequest) {
    await this.rateLimit.consume("reset-ip", request.ip, 10, 900);
    return this.auth.resetPassword(input, requestMetadata(request));
  }

  @AllowPendingMfa()
  @Post("totp/setup")
  async setupTotp(@Req() request: FastifyRequest) {
    await this.rateLimit.consume("totp-setup", request.authContext!.userId, 5, 3_600);
    return this.auth.setupTotp(request.authContext!, requestMetadata(request));
  }

  @AllowPendingMfa()
  @Post("totp/confirm")
  async confirmTotp(
    @Body() input: TotpCodeDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.rateLimit.consume("totp-confirm", request.authContext!.userId, 10, 300);
    const result = await this.auth.confirmTotp(
      request.authContext!,
      input.code,
      requestMetadata(request),
    );
    this.sessions.setCookie(reply, result.session);
    return result.body;
  }

  @AllowPendingMfa()
  @Post("totp/verify")
  async verifyTotp(
    @Body() input: TotpCodeDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.rateLimit.consume("totp-verify", request.authContext!.userId, 10, 300);
    const result = await this.auth.verifyTotp(
      request.authContext!,
      input.code,
      requestMetadata(request),
    );
    this.sessions.setCookie(reply, result.session);
    return result.body;
  }

  // Support tool for environments without working transactional email (e.g.
  // staging with SMTP_ENABLED=false). See AuthService.adminPendingToken for
  // the two independent guards: a non-production-only config derivation and
  // this admin-only permission on a fully authenticated, TOTP-verified route.
  @RequirePermissions("auth:tokens:read")
  @Get("admin/pending-token")
  async adminPendingToken(@Query() query: unknown, @Req() request: FastifyRequest) {
    await this.rateLimit.consume("admin-token-lookup", request.authContext!.userId, 30, 3_600);
    return this.auth.adminPendingToken(query, request.authContext!, requestMetadata(request));
  }

  @RequirePermissions("staff:invite")
  @Post("staff/invitations")
  async inviteStaff(@Body() input: InviteStaffDto, @Req() request: FastifyRequest) {
    await this.rateLimit.consume("staff-invite", request.authContext!.userId, 20, 3_600);
    return this.auth.inviteStaff(input, request.authContext!, requestMetadata(request));
  }

  @Public()
  @Post("staff/invitations/accept")
  async acceptStaffInvitation(
    @Body() input: AcceptStaffInvitationDto,
    @Req() request: FastifyRequest,
  ) {
    await this.rateLimit.consume("staff-accept-ip", request.ip, 10, 900);
    return this.auth.acceptStaffInvitation(input, requestMetadata(request));
  }
}
