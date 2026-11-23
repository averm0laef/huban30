import { Body, Controller, Get, HttpCode, Param, PayloadTooLargeException, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { RequirePermissions } from "../auth/auth.decorators.js";
import { RateLimitService } from "../security/rate-limit.service.js";
import { ProductPhotosService, type PhotoUpload } from "./product-photos.service.js";

/** One file of the request, whole. The multipart limits of main.ts (one file, 15 МБ) bound it. */
async function uploadOf(request: FastifyRequest): Promise<PhotoUpload | undefined> {
  const file = await request.file();
  if (!file) return undefined;
  try {
    return { content: await file.toBuffer(), fileName: file.filename || "photo" };
  } catch (error) {
    if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") throw new PayloadTooLargeException("Допустимый размер фото: до 15 МБ");
    throw error;
  }
}

/** «Фото товаров» in the staff workspace (docs/PRODUCT_PHOTOS.md). */
@Controller("staff/catalog/photos")
export class ProductPhotosController {
  constructor(
    private readonly photos: ProductPhotosService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get("summary")
  @RequirePermissions("catalog:write")
  summary() {
    return this.photos.summary();
  }

  @Get("queue")
  @RequirePermissions("catalog:write")
  queue(@Query() query: unknown) {
    return this.photos.queue(query);
  }

  @Get("images")
  @RequirePermissions("catalog:write")
  images(@Query() query: unknown) {
    return this.photos.images(query);
  }

  @Post("products/:productId")
  @HttpCode(200)
  @RequirePermissions("catalog:write")
  async attach(@Param("productId") productId: string, @Query() query: unknown, @Req() request: FastifyRequest) {
    await this.rateLimit.consume("product-photo-upload", request.authContext!.userId, 1_500, 3_600);
    return this.photos.attach(productId, query, await uploadOf(request), request.authContext!);
  }

  @Post("by-file-name")
  @HttpCode(200)
  @RequirePermissions("catalog:write")
  async attachByFileName(@Query() query: unknown, @Req() request: FastifyRequest) {
    await this.rateLimit.consume("product-photo-upload", request.authContext!.userId, 1_500, 3_600);
    return this.photos.attachByFileName(query, await uploadOf(request), request.authContext!);
  }

  @Post("images/:imageId/withdraw")
  @HttpCode(200)
  @RequirePermissions("catalog:write")
  withdraw(@Param("imageId") imageId: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    return this.photos.withdraw(imageId, body, request.authContext!);
  }

  @Get("sources")
  @RequirePermissions("catalog:write")
  sources() {
    return this.photos.rightsSources();
  }

  @Post("sources")
  @RequirePermissions("catalog:write")
  createSource(@Body() body: unknown, @Req() request: FastifyRequest) {
    return this.photos.createRightsSource(body, request.authContext!);
  }

  @Post("sources/:sourceId/revoke")
  @HttpCode(200)
  @RequirePermissions("catalog:write")
  revokeSource(@Param("sourceId") sourceId: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    return this.photos.revokeRightsSource(sourceId, body, request.authContext!);
  }
}
