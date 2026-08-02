import { Controller, Get, Headers, Param, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import { Public } from "../auth/auth.decorators.js";
import { RateLimitService } from "../security/rate-limit.service.js";
import { CatalogPublicService } from "./catalog-public.service.js";

const MEDIA_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";

@Public()
@Controller("catalog")
export class CatalogPublicController {
  constructor(
    private readonly catalog: CatalogPublicService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get("categories")
  async categories(@Req() request: FastifyRequest) {
    await this.rateLimit.consume("catalog-categories", request.ip, 60, 60);
    return this.catalog.categories();
  }

  @Get("brands")
  async brands(@Req() request: FastifyRequest) {
    await this.rateLimit.consume("catalog-brands", request.ip, 60, 60);
    return this.catalog.brands();
  }

  @Get("products")
  async products(@Query() query: unknown, @Req() request: FastifyRequest) {
    await this.rateLimit.consume("catalog-products", request.ip, 60, 60);
    return this.catalog.products(query);
  }

  @Get("products/:idOrSlug")
  async product(@Param("idOrSlug") idOrSlug: string, @Req() request: FastifyRequest) {
    await this.rateLimit.consume("catalog-product", request.ip, 120, 60);
    return this.catalog.product(idOrSlug);
  }

  @Get("featured")
  async featured(@Query() query: unknown, @Req() request: FastifyRequest) {
    await this.rateLimit.consume("catalog-featured", request.ip, 60, 60);
    return this.catalog.featured(query);
  }

  @Get("media/:imageId")
  async media(
    @Param("imageId") imageId: string,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    await this.rateLimit.consume("catalog-media", request.ip, 120, 60);
    const media = await this.catalog.media(imageId, ifNoneMatch);
    if (media.content === null) {
      return reply
        .header("Cache-Control", MEDIA_CACHE_CONTROL)
        .header("ETag", media.etag)
        .header("X-Content-Type-Options", "nosniff")
        .status(304)
        .send();
    }
    return reply
      .header("Cache-Control", MEDIA_CACHE_CONTROL)
      .header("Content-Length", String(media.content.length))
      .header("Content-Type", media.mimeType)
      .header("ETag", media.etag)
      .header("X-Content-Type-Options", "nosniff")
      .send(media.content);
  }
}
