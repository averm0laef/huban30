import "reflect-metadata";

import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";

import type { Role } from "@an30/contracts";

import { PermissionsGuard } from "../auth/permissions.guard.js";
import { StaffController } from "./staff.controller.js";

function catalogContext(role: Role): ExecutionContext {
  return {
    getClass: () => StaffController,
    getHandler: () => StaffController.prototype.catalog,
    switchToHttp: () => ({ getRequest: () => ({ authContext: { role } }) }),
  } as unknown as ExecutionContext;
}

describe("staff catalog authorization", () => {
  const guard = new PermissionsGuard(new Reflector());

  it("forbids a customer from reading the internal catalog, including inactive products", () => {
    expect(() => guard.canActivate(catalogContext("customer"))).toThrow(ForbiddenException);
    try {
      guard.canActivate(catalogContext("customer"));
    } catch (error) {
      expect((error as ForbiddenException).getStatus()).toBe(403);
    }
  });

  it.each(["manager", "director", "admin"] satisfies Role[])(
    "allows the %s role to read the internal catalog",
    (role) => {
      expect(guard.canActivate(catalogContext(role))).toBe(true);
    },
  );
});
