import { Module } from "@nestjs/common";

import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { SessionService } from "./session.service.js";

@Module({
  controllers: [AuthController],
  exports: [SessionService],
  providers: [AuthService, SessionService],
})
export class AuthModule {}
