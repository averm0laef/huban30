import { Controller, Get, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";

import { RequirePermissions } from "../auth/auth.decorators.js";
import { CatalogQualityService, QUALITY_CHECKS } from "./catalog-quality.service.js";

/** «Качество каталога» in the staff workspace: counts, one list at a time, and the list as a table for 1С. */
@Controller("staff/catalog/quality")
export class CatalogQualityController {
  constructor(private readonly quality: CatalogQualityService) {}

  @Get("summary")
  @RequirePermissions("catalog:write")
  summary() {
    return this.quality.summary();
  }

  @Get()
  @RequirePermissions("catalog:write")
  list(@Query() query: unknown) {
    return this.quality.list(query);
  }

  @Get("export")
  @RequirePermissions("catalog:write")
  async export(@Query() query: { check?: unknown }, @Res({ passthrough: true }) reply: FastifyReply) {
    const csv = await this.quality.csv(query?.check);
    const check = QUALITY_CHECKS.find((name) => name === query?.check) ?? "list";
    reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="an30-quality-${check}.csv"`);
    return csv;
  }
}
