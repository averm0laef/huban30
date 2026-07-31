import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";

import { SessionService } from "./session.service.js";
import { SKIP_CSRF_KEY } from "./auth.decorators.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly appOrigin: string;

  constructor(
    config: ConfigService,
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {
    this.appOrigin = config.getOrThrow<string>("APP_ORIGIN");
  }

  canActivate(context: ExecutionContext): boolean {
    const skipCsrf = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skipCsrf) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (SAFE_METHODS.has(request.method)) return true;
    if (request.headers.origin !== this.appOrigin) {
      throw new ForbiddenException("Недопустимый Origin");
    }
    if (!request.authContext) return true;
    const csrfToken = request.headers["x-csrf-token"];
    if (typeof csrfToken !== "string" || csrfToken.length > 256) {
      throw new BadRequestException("Отсутствует CSRF-токен");
    }
    if (!this.sessions.csrfMatches(csrfToken, request.authContext.csrfTokenHash)) {
      throw new ForbiddenException("CSRF-токен недействителен");
    }
    return true;
  }
}
