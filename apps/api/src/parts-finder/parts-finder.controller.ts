import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

import { Public, RequirePermissions } from "../auth/auth.decorators.js";
import { RateLimitService } from "../security/rate-limit.service.js";
import { PartsFinderAssortmentService } from "./parts-finder-assortment.service.js";
import { PartsFinderCrossReviewService } from "./parts-finder-cross-review.service.js";
import { PartsFinderService } from "./parts-finder.service.js";
import { PartsFinderVehiclesService } from "./parts-finder-vehicles.service.js";

const AssortmentLinkSchema = z.object({ maxCredits: z.number().int().min(10).max(20_000).default(2_000) }).strict();

/** Per-IP limits; crosses spend FAPI credits, so they are the tightest. */
export const PARTS_FINDER_RATE_LIMITS = {
  crosses: { limit: 6, scope: "parts-finder-crosses", windowSeconds: 600 },
  picker: { limit: 60, scope: "parts-finder-picker", windowSeconds: 60 },
  resolve: { limit: 30, scope: "parts-finder-resolve", windowSeconds: 60 },
  search: { limit: 30, scope: "parts-finder-search", windowSeconds: 60 },
  shopAnalogs: { limit: 30, scope: "parts-finder-shop-analogs", windowSeconds: 60 },
  suggest: { limit: 120, scope: "parts-finder-suggest", windowSeconds: 60 },
  vehicle: { limit: 20, scope: "parts-finder-vehicle", windowSeconds: 60 },
} as const;

@Public()
@Controller("parts-finder")
export class PartsFinderController {
  constructor(
    private readonly rateLimit: RateLimitService,
    private readonly finder: PartsFinderService,
  ) {}

  @Get("status")
  status() {
    return this.finder.status();
  }

  @Post("resolve")
  @HttpCode(200)
  async resolve(@Body() body: unknown, @Req() request: FastifyRequest) {
    await this.throttle("resolve", request);
    return this.finder.resolve(body, { ip: request.ip });
  }

  @Post("search")
  @HttpCode(200)
  async search(@Body() body: unknown, @Req() request: FastifyRequest) {
    await this.throttle("search", request);
    return this.finder.search(body, { ip: request.ip });
  }

  @Post("vehicle")
  @HttpCode(200)
  async vehicle(@Body() body: unknown, @Req() request: FastifyRequest) {
    await this.throttle("vehicle", request);
    return this.finder.vehicle(body);
  }

  @Post("crosses")
  @HttpCode(200)
  async crosses(@Body() body: unknown, @Req() request: FastifyRequest) {
    await this.throttle("crosses", request);
    return this.finder.crosses(body, { ip: request.ip });
  }

  @Post("shop-analogs")
  @HttpCode(200)
  async shopAnalogs(@Body() body: unknown, @Req() request: FastifyRequest) {
    await this.throttle("shopAnalogs", request);
    return this.finder.shopAnalogs(body);
  }

  @Get("makes")
  async makes(@Req() request: FastifyRequest) {
    await this.throttle("picker", request);
    return this.finder.makes();
  }

  @Get("models")
  async models(@Query() query: unknown, @Req() request: FastifyRequest) {
    await this.throttle("picker", request);
    return this.finder.models(query);
  }

  @Get("modifications")
  async modifications(@Query() query: unknown, @Req() request: FastifyRequest) {
    await this.throttle("picker", request);
    return this.finder.modifications(query);
  }

  @Get("vehicles/suggest")
  async suggest(@Query() query: unknown, @Req() request: FastifyRequest) {
    await this.throttle("suggest", request);
    return this.finder.suggest(query);
  }

  @Get("vehicles/understand")
  async understand(@Query() query: unknown, @Req() request: FastifyRequest) {
    await this.throttle("suggest", request);
    return this.finder.understand(query);
  }

  private async throttle(route: keyof typeof PARTS_FINDER_RATE_LIMITS, request: FastifyRequest) {
    const { limit, scope, windowSeconds } = PARTS_FINDER_RATE_LIMITS[route];
    await this.rateLimit.consume(scope, request.ip, limit, windowSeconds);
  }
}

@Controller("staff/parts-finder")
export class StaffPartsFinderController {
  constructor(
    private readonly finder: PartsFinderService,
    private readonly vehicles: PartsFinderVehiclesService,
    private readonly assortment: PartsFinderAssortmentService,
    private readonly review: PartsFinderCrossReviewService,
  ) {}

  // Not catalog:read: every customer holds that permission. FAPI package
  // balance is operator information for the catalog staff.
  @RequirePermissions("catalog:write")
  @Get("usage")
  usage() {
    return this.finder.usage();
  }

  /** «Подбор и поставщики» card: credits today, package remainder, supplier and VIN cache state. */
  @RequirePermissions("catalog:write")
  @Get("overview")
  overview() {
    return this.finder.staffOverview();
  }

  /** Size of the UMAPI vehicle catalog and its last load (docs/UMAPI.md). */
  @RequirePermissions("catalog:write")
  @Get("vehicles")
  vehicleCatalog() {
    return this.vehicles.catalogStatus();
  }

  /** How much of our assortment is linked to original numbers and analogs. */
  @RequirePermissions("catalog:write")
  @Get("assortment")
  assortmentStatus() {
    return this.assortment.status();
  }

  /** Starts linking our products to the parts catalogue in the background (one run at a time). */
  @RequirePermissions("catalog:write")
  @Post("assortment/link")
  @HttpCode(202)
  linkAssortment(@Body() body: unknown) {
    const parsed = AssortmentLinkSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException({ code: "invalid_assortment_link", error: "Проверьте лимит кредитов." });
    return this.assortment.start(parsed.data.maxCredits);
  }

  /** Presumptive analogs of our products waiting for a staff decision. */
  @RequirePermissions("catalog:write")
  @Get("crosses/review")
  crossReview(@Query() query: unknown) {
    return this.review.list(query);
  }

  @RequirePermissions("catalog:write")
  @Post("crosses/:id/decision")
  @HttpCode(200)
  decideCross(@Param("id") id: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    return this.review.decide(id, body, request.authContext!);
  }
}
