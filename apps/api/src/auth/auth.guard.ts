import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";

import { PENDING_MFA_KEY, PUBLIC_ROUTE_KEY } from "./auth.decorators.js";
import { SESSION_COOKIE_NAME, SessionService } from "./session.service.js";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (!token) throw new UnauthorizedException("Требуется вход");
    const auth = await this.sessions.resolve(token);
    if (!auth) throw new UnauthorizedException("Сессия недействительна или истекла");
    request.authContext = auth;

    const allowPendingMfa = this.reflector.getAllAndOverride<boolean>(PENDING_MFA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (auth.role !== "customer" && !auth.mfaVerified && !allowPendingMfa) {
      throw new UnauthorizedException("Требуется подтверждение TOTP");
    }
    return true;
  }
}
