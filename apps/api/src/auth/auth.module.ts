import { Module } from "@nestjs/common";

import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { SessionService } from "./session.service.js";
import { SocialAuthController } from "./social-auth.controller.js";
import { SocialAuthService } from "./social-auth.service.js";

@Module({
  controllers: [AuthController, SocialAuthController],
  exports: [SessionService],
  providers: [AuthService, SessionService, SocialAuthService],
})
export class AuthModule {}
