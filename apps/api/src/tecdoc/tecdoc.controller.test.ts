import { HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";

import { PERMISSIONS_KEY, PUBLIC_ROUTE_KEY } from "../auth/auth.decorators.js";
import { GarageController } from "../garage/garage.controller.js";
import { StaffTecdocController, TecdocController, tecdocHttpError } from "./tecdoc.controller.js";
import { TecdocError } from "./tecdoc.gateway.js";

const reflector = new Reflector();
const routes = (controller: { prototype: object }) => Object.getOwnPropertyNames(controller.prototype).filter((name) => name !== "constructor");
const permissions = (controller: { prototype: object }, name: string) => reflector.get(PERMISSIONS_KEY, (controller.prototype as Record<string, () => unknown>)[name]!);

describe("tecdoc and garage routes", () => {
  it("opens the catalogue to visitors and keeps usage, the key check and the cache behind a staff permission", () => {
    expect(reflector.get(PUBLIC_ROUTE_KEY, TecdocController)).toBe(true);
    expect(reflector.get(PUBLIC_ROUTE_KEY, StaffTecdocController)).toBeUndefined();
    expect(routes(StaffTecdocController).sort()).toEqual(["clearCache", "probe", "status"]);
    for (const name of routes(StaffTecdocController)) expect(permissions(StaffTecdocController, name), name).toEqual(["catalog:write"]);
  });

  it("lets only the signed-in customer read and change the own garage", () => {
    expect(reflector.get(PUBLIC_ROUTE_KEY, GarageController)).toBeUndefined();
    expect(permissions(GarageController, "list")).toEqual(["account:read:self"]);
    for (const name of ["add", "makePrimary", "remove"]) expect(permissions(GarageController, name), name).toEqual(["account:update:self"]);
  });

  it("never tells a customer about keys, quotas or the provider", () => {
    const body = (error: unknown) => (tecdocHttpError(error).getResponse() as { code: string; error: string });
    const cases: Array<[unknown, number, string]> = [
      [new TecdocError("disabled", "no key"), 503, "tecdoc_disabled"],
      [new TecdocError("limited", "day"), 429, "tecdoc_limited"],
      [new TecdocError("limited", "visitor"), 429, "tecdoc_limited"],
      [new TecdocError("refused", "http 401"), 503, "tecdoc_unavailable"],
      [new TecdocError("unavailable", "TimeoutError"), 503, "tecdoc_unavailable"],
      [new Error("boom"), 503, "tecdoc_unavailable"],
    ];
    for (const [error, status, code] of cases) {
      expect(tecdocHttpError(error).getStatus()).toBe(status);
      expect(body(error).code).toBe(code);
      // «подключён» is fine; the word «ключ» itself is not.
      expect(body(error).error).not.toMatch(/tecdoc|(?<![а-яё])ключ|лимит|пакет|квот|401|timeout/iu);
    }
    const passed = new HttpException("as is", 400);
    expect(tecdocHttpError(passed)).toBe(passed);
  });
});
