import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";

import { PERMISSIONS_KEY, PUBLIC_ROUTE_KEY } from "../auth/auth.decorators.js";
import { CatalogQualityController } from "./catalog-quality.controller.js";
import type { CatalogQualityService } from "./catalog-quality.service.js";

const reflector = new Reflector();

describe("«Качество каталога» routes", () => {
  it("are the staff's, behind the permission to change the catalogue", () => {
    expect(reflector.get(PUBLIC_ROUTE_KEY, CatalogQualityController)).toBeUndefined();
    for (const name of ["summary", "list", "export"] as const) {
      expect(reflector.get(PERMISSIONS_KEY, CatalogQualityController.prototype[name]), name).toEqual(["catalog:write"]);
    }
  });

  it("hands Excel a file to save, named after the check", async () => {
    const csv = vi.fn(async () => "\uFEFFКод 1С;…\r\n");
    const controller = new CatalogQualityController({ csv } as unknown as CatalogQualityService);
    const headers = new Map<string, string>();
    const reply = { header: (name: string, value: string) => { headers.set(name, value); return reply; } };
    expect(await controller.export({ check: "no_brand" }, reply as never)).toBe("\uFEFFКод 1С;…\r\n");
    expect(csv).toHaveBeenCalledWith("no_brand");
    expect(headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(headers.get("Content-Disposition")).toBe('attachment; filename="an30-quality-no_brand.csv"');
  });
});
