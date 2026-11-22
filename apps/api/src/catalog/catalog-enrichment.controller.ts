import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { RequirePermissions } from "../auth/auth.decorators.js";
import { CatalogEnrichmentService } from "./catalog-enrichment.service.js";

@Controller("catalog/enrichment")
export class CatalogEnrichmentController {
  constructor(private readonly enrichment:CatalogEnrichmentService) {}
  @Get("status") @RequirePermissions("catalog:write") status() { return this.enrichment.status(); }
  @Post("match") @RequirePermissions("catalog:write") match(@Body() body:unknown,@Req() request:FastifyRequest) {
    return this.enrichment.match(body,request.authContext!);
  }
}
