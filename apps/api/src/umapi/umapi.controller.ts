import { BadRequestException, Controller, Get, Header, HttpCode, HttpException, HttpStatus, Param, Post, Query, Req, StreamableFile } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

import { Public, RequirePermissions } from "../auth/auth.decorators.js";
import { RateLimitService } from "../security/rate-limit.service.js";
import { UmapiBudgetService } from "./umapi-budget.service.js";
import { UmapiCacheService } from "./umapi-cache.service.js";
import { UmapiPhotoArchiveService } from "./umapi-photo-archive.service.js";
import { UmapiError, UmapiGateway, type UmapiCaller } from "./umapi.gateway.js";
import { UmapiService } from "./umapi.service.js";

const id = z.coerce.number().int().min(1).max(2_000_000_000);
// «check» — does it fit the customer's car (needs the car); «list» — which cars it fits.
const FitmentQuery = z.object({ mode: z.enum(["check", "list"]).default("list"), model: id.optional(), mod: id.optional() });

const MESSAGES = {
  disabled: "Проверка по каталогу пока не подключена. Специалист проверит деталь по VIN.",
  limited: "Сегодня проверок по каталогу больше нет. Оставьте VIN — специалист проверит вручную.",
  unavailable: "Проверка по каталогу сейчас недоступна. Попробуйте через несколько минут или спросите специалиста.",
} as const;

/** Customers never see keys, quotas or the provider's name in an error. */
export function umapiHttpError(error: unknown): HttpException {
  if (error instanceof HttpException) return error;
  if (error instanceof UmapiError) {
    if (error.failure === "disabled") return new HttpException({ code: "catalogue_disabled", error: MESSAGES.disabled }, HttpStatus.SERVICE_UNAVAILABLE);
    if (error.failure === "limited") return new HttpException({ code: "catalogue_limited", error: MESSAGES.limited }, HttpStatus.TOO_MANY_REQUESTS);
  }
  return new HttpException({ code: "catalogue_unavailable", error: MESSAGES.unavailable }, HttpStatus.SERVICE_UNAVAILABLE);
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequestException({ code: "invalid_request", error: "Проверьте параметры запроса." });
  return parsed.data;
}

function caller(request: FastifyRequest): UmapiCaller {
  return { ip: request.ip, userId: request.authContext?.userId ?? null };
}

/**
 * The product page's catalogue buttons: compatibility, the cars a part fits, our products among its analogs, its
 * photo. Each answers one visitor's press; the routes sit under /api/ (closed to crawlers). No per-address limit on
 * presses (owner, 24.11.2026): only the store's day of the tariff (UMAPI_DAILY_LIMIT) and the proxy's flood guard.
 */
@Public()
@Controller("umapi")
export class UmapiController {
  constructor(private readonly umapi: UmapiService) {}

  @Get("status")
  status() {
    return this.umapi.status();
  }

  @Get("product/:productId/fitment")
  async fitment(@Param("productId") productId: string, @Query() query: unknown, @Req() request: FastifyRequest) {
    const product = parse(z.uuid(), productId);
    const { mode, model, mod } = parse(FitmentQuery, query);
    return this.umapi.productFitment(product, { ...(model ? { modelId: model } : {}), ...(mod ? { modificationId: mod } : {}) }, caller(request), mode)
      .catch((error: unknown) => { throw umapiHttpError(error); });
  }

  @Get("product/:productId/analogs")
  async analogs(@Param("productId") productId: string, @Req() request: FastifyRequest) {
    const product = parse(z.uuid(), productId);
    return this.umapi.productAnalogs(product, caller(request)).catch((error: unknown) => { throw umapiHttpError(error); });
  }

  @Get("number/analogs")
  @Header("Cache-Control", "no-store")
  async numberAnalogs(@Query() input: unknown, @Req() request: FastifyRequest) {
    const { article, brand } = parse(z.object({ article: z.string().trim().min(2).max(64), brand: z.string().trim().min(1).max(80).optional() }), input);
    return this.umapi.numberAnalogs(article, brand, caller(request)).catch((error: unknown) => { throw umapiHttpError(error); });
  }

  @Get("product/:productId/photos")
  @Header("Cache-Control", "no-store")
  async photos(@Param("productId") productId: string, @Req() request: FastifyRequest) {
    const product = parse(z.uuid(), productId);
    return this.umapi.productPhotos(product, caller(request)).catch((error: unknown) => { throw umapiHttpError(error); });
  }
}

/** Staff: what the day's requests are spent on, and emptying the display cache. */
@Controller("staff/umapi")
export class StaffUmapiController {
  constructor(
    private readonly gateway: UmapiGateway,
    private readonly budget: UmapiBudgetService,
    private readonly cache: UmapiCacheService,
    private readonly archive: UmapiPhotoArchiveService,
    private readonly limits: RateLimitService,
  ) {}

  @RequirePermissions("catalog:write")
  @Get("status")
  async status() {
    const [usage, cached] = await Promise.all([this.budget.status(), this.cache.size().catch(() => null)]);
    return { ...this.gateway.health, cache: { entries: cached, maxEntries: this.cache.maxEntries, ttlSeconds: this.cache.ttlSeconds }, usage };
  }

  @Get("photos")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions("catalog:write")
  photos(@Query() query: unknown) {
    return this.archive.list(query);
  }

  @Post("photos/:id/save")
  @HttpCode(200)
  @RequirePermissions("catalog:write")
  async savePhoto(@Param("id") id: string, @Req() request: FastifyRequest) {
    const photoId = parse(z.uuid(), id);
    await this.limits.consume("umapi-photo-save", request.authContext!.userId, 20, 60);
    return this.archive.save(photoId);
  }

  @Get("photos/:id/file")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions("catalog:write")
  async downloadPhoto(@Param("id") id: string) {
    const { bytes, name } = await this.archive.file(parse(z.uuid(), id));
    return new StreamableFile(bytes, { disposition: `attachment; filename="${name}"`, length: bytes.length, type: "image/jpeg" });
  }

  /** Empties the display cache (also the step to take when the contract ends). */
  @RequirePermissions("catalog:write")
  @Post("cache/clear")
  @HttpCode(200)
  async clearCache() {
    return { removed: await this.cache.clear() };
  }
}
