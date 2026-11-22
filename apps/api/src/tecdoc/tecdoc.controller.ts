import { BadRequestException, Controller, Get, HttpCode, HttpException, HttpStatus, Param, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

import { Public, RequirePermissions } from "../auth/auth.decorators.js";
import { RateLimitService } from "../security/rate-limit.service.js";
import { TecdocBudgetService } from "./tecdoc-budget.service.js";
import { TecdocCacheService } from "./tecdoc-cache.service.js";
import { TecdocError, TecdocGateway, type TecdocCaller } from "./tecdoc.gateway.js";
import { TecdocService } from "./tecdoc.service.js";

const id = z.coerce.number().int().min(1).max(2_000_000_000);
const MakeQuery = z.object({ make: id });
const ModelQuery = z.object({ model: id });
const CategoriesQuery = z.object({ gen: id, q: z.string().trim().max(80).optional() });
const PartsQuery = z.object({ all: z.enum(["0", "1"]).default("0"), category: id, gen: id, page: z.coerce.number().int().min(1).max(20).default(1) });
// «check» — does it fit the customer's car (needs the car's model); «list» — which cars it fits.
const FitmentQuery = z.object({ gen: id.optional(), mode: z.enum(["check", "list"]).default("list"), ms: id.optional() })
  .refine((query) => query.mode === "list" || query.ms !== undefined);
// Checks of applicability one visitor may ask for in a day (docs/TECDOC.md): the package is not spent on curiosity.
const FITMENT_CHECKS_PER_DAY = 30;
const Vin = z.string().trim().toUpperCase().regex(/^[A-HJ-NPR-Z0-9]{17}$/u);

const MESSAGES = {
  disabled: "Каталог автомобилей пока не подключён. Поиск по нашему каталогу работает.",
  limited: "Каталог автомобилей сейчас перегружен запросами. Повторите через несколько минут или напишите нам — подберём вручную.",
  unavailable: "Каталог автомобилей временно недоступен. Поиск по нашему каталогу работает, а специалист подберёт деталь вручную.",
} as const;

/** Customers never see keys, quotas or the provider's name in an error. */
export function tecdocHttpError(error: unknown): HttpException {
  if (error instanceof HttpException) return error;
  if (error instanceof TecdocError) {
    if (error.failure === "disabled") return new HttpException({ code: "tecdoc_disabled", error: MESSAGES.disabled }, HttpStatus.SERVICE_UNAVAILABLE);
    if (error.failure === "limited") return new HttpException({ code: "tecdoc_limited", error: MESSAGES.limited }, HttpStatus.TOO_MANY_REQUESTS);
  }
  return new HttpException({ code: "tecdoc_unavailable", error: MESSAGES.unavailable }, HttpStatus.SERVICE_UNAVAILABLE);
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequestException({ code: "invalid_request", error: "Проверьте параметры запроса." });
  return parsed.data;
}

function caller(request: FastifyRequest): TecdocCaller {
  return { ip: request.ip, userId: request.authContext?.userId ?? null };
}

/**
 * The vehicle catalogue and applicability for the storefront. Every route is
 * an answer to what one visitor is looking at; the routes sit under /api/
 * (closed to crawlers in robots.txt) and are rate-limited per address.
 */
@Public()
@Controller("tecdoc")
export class TecdocController {
  constructor(
    private readonly tecdoc: TecdocService,
    private readonly limits: RateLimitService,
  ) {}

  @Get("status")
  status() {
    return { enabled: this.tecdoc.enabled };
  }

  @Get("makes")
  async makes(@Req() request: FastifyRequest) {
    await this.limits.consume("tecdoc-picker", request.ip, 90, 60);
    return this.tecdoc.makes(caller(request)).catch((error: unknown) => { throw tecdocHttpError(error); });
  }

  @Get("models")
  async models(@Query() query: unknown, @Req() request: FastifyRequest) {
    const { make } = parse(MakeQuery, query);
    await this.limits.consume("tecdoc-picker", request.ip, 90, 60);
    return this.tecdoc.models(make, caller(request)).catch((error: unknown) => { throw tecdocHttpError(error); });
  }

  @Get("modifications")
  async modifications(@Query() query: unknown, @Req() request: FastifyRequest) {
    const { model } = parse(ModelQuery, query);
    await this.limits.consume("tecdoc-picker", request.ip, 90, 60);
    return this.tecdoc.modifications(model, caller(request)).catch((error: unknown) => { throw tecdocHttpError(error); });
  }

  @Get("vin/:vin")
  async vin(@Param("vin") value: string, @Req() request: FastifyRequest) {
    const vin = parse(Vin, value);
    await this.limits.consume("tecdoc-vin", request.ip, 10, 600);
    return this.tecdoc.vin(vin, caller(request)).catch((error: unknown) => { throw tecdocHttpError(error); });
  }

  @Get("categories")
  async categories(@Query() query: unknown, @Req() request: FastifyRequest) {
    const { gen, q } = parse(CategoriesQuery, query);
    await this.limits.consume("tecdoc-parts", request.ip, 40, 60);
    return this.tecdoc.categories(gen, q, caller(request)).catch((error: unknown) => { throw tecdocHttpError(error); });
  }

  @Get("parts")
  async parts(@Query() query: unknown, @Req() request: FastifyRequest) {
    const { all, category, gen, page } = parse(PartsQuery, query);
    await this.limits.consume("tecdoc-parts", request.ip, 40, 60);
    return this.tecdoc.parts({ all: all === "1", categoryId: category, genId: gen, page }, caller(request))
      .catch((error: unknown) => { throw tecdocHttpError(error); });
  }

  /** Which cars a product of ours fits (mode=list), or whether it fits the visitor's own car (mode=check): a button each. */
  @Get("product/:productId/fitment")
  async fitment(@Param("productId") productId: string, @Query() query: unknown, @Req() request: FastifyRequest) {
    const product = parse(z.uuid(), productId);
    const { gen, mode, ms } = parse(FitmentQuery, query);
    await this.limits.consume("tecdoc-fitment", request.ip, 30, 60);
    await this.limits.consume("tecdoc-fitment-day", request.ip, FITMENT_CHECKS_PER_DAY, 86_400);
    return this.tecdoc.productFitment(product, { ...(gen ? { genId: gen } : {}), ...(ms ? { msId: ms } : {}) }, caller(request), mode)
      .catch((error: unknown) => { throw tecdocHttpError(error); });
  }
}

/** Staff: what the package is spent on, and a check that the key works. */
@Controller("staff/tecdoc")
export class StaffTecdocController {
  constructor(
    private readonly tecdoc: TecdocService,
    private readonly gateway: TecdocGateway,
    private readonly budget: TecdocBudgetService,
    private readonly cache: TecdocCacheService,
  ) {}

  @RequirePermissions("catalog:write")
  @Get("status")
  async status() {
    const [usage, cached] = await Promise.all([this.budget.status(), this.cache.size().catch(() => null)]);
    return { ...this.gateway.health, cache: { entries: cached, maxEntries: this.cache.maxEntries, ttlSeconds: this.cache.ttlSeconds }, usage };
  }

  /** Up to six real calls: make → model → engine → categories. */
  @RequirePermissions("catalog:write")
  @Post("probe")
  @HttpCode(200)
  async probe(@Req() request: FastifyRequest) {
    try {
      return { ok: true as const, ...(await this.tecdoc.probe(caller(request))) };
    } catch (error) {
      const failure = error instanceof TecdocError ? error : null;
      return { detail: failure?.detail ?? "unknown", failure: failure?.failure ?? "unavailable", ok: false as const };
    }
  }

  /** Empties the display cache (also the step to take when the contract ends). */
  @RequirePermissions("catalog:write")
  @Post("cache/clear")
  @HttpCode(200)
  async clearCache() {
    return { removed: await this.cache.clear() };
  }
}
