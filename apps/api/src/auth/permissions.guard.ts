import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";

import { ROLE_PERMISSIONS, type Permission } from "@an30/contracts";

import { PERMISSIONS_KEY } from "./auth.decorators.js";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? [];
    if (required.length === 0) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const auth = request.authContext;
    if (!auth) throw new ForbiddenException("Недостаточно прав");
    const granted: readonly Permission[] = ROLE_PERMISSIONS[auth.role];
    if (!required.every((permission) => granted.includes(permission))) {
      throw new ForbiddenException("Недостаточно прав");
    }
    return true;
  }
}
