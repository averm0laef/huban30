import "reflect-metadata";
import { describe,expect,it } from "vitest";
import { ClientHubController } from "./client-hub.controller.js";
import { PERMISSIONS_KEY,PUBLIC_ROUTE_KEY,SKIP_CSRF_KEY } from "../auth/auth.decorators.js";
describe("hub route permissions",()=>{
  it.each(["saveConnection","diagnose","activate","saveSettings"] as const)("restricts connection configuration: %s",method=>{
    expect(Reflect.getMetadata(PERMISSIONS_KEY,ClientHubController.prototype[method])).toEqual(["settings:manage"]);
  });
  it.each(["assign","close","release","reply","conversations","messages"] as const)("restricts inbox data: %s",method=>{
    expect(Reflect.getMetadata(PERMISSIONS_KEY,ClientHubController.prototype[method])).toEqual(["inbox:manage"]);
    expect(Reflect.getMetadata(PUBLIC_ROUTE_KEY,ClientHubController.prototype[method])).toBeUndefined();
  });
  it.each(["challenge","webhook"] as const)("allows signed provider callbacks without a staff session: %s",method=>{
    expect(Reflect.getMetadata(PUBLIC_ROUTE_KEY,ClientHubController.prototype[method])).toBe(true);
    expect(Reflect.getMetadata(SKIP_CSRF_KEY,ClientHubController.prototype[method])).toBe(true);
  });
});
