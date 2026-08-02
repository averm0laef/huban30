import { BadRequestException, Controller, Get, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodError } from "zod";

import { Public } from "../auth/auth.decorators.js";
import { RateLimitService } from "../security/rate-limit.service.js";
import { CatalogSearchService } from "./catalog-search.service.js";

@Public()
@Controller("catalog")
export class CatalogSearchController {
  constructor(
    private readonly searchService: CatalogSearchService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get("search")
  async search(@Query() query: unknown, @Req() request: FastifyRequest) {
    try {
      await this.rateLimit.consume("catalog-search", request.ip, 120, 60);
      return await this.searchService.search(query);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({ error: "invalid_search_query", issues: error.issues });
      }
      throw error;
    }
  }
}
