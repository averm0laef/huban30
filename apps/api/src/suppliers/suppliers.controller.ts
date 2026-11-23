import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { Public, RequirePermissions } from "../auth/auth.decorators.js";
import { RateLimitService } from "../security/rate-limit.service.js";
import { SupplierCrossFillService } from "./supplier-cross-fill.service.js";
import { SupplierSearchService } from "./supplier-search.service.js";
import { SupplierWaitlistService } from "./supplier-waitlist.service.js";

function metadata(request: FastifyRequest) {
  const userAgent = request.headers["user-agent"];
  return { ipAddress: request.ip, userAgent: typeof userAgent === "string" ? userAgent : undefined };
}

@Public()
@Controller("suppliers")
export class SupplierSearchController {
  constructor(
    private readonly rateLimit: RateLimitService,
    private readonly search: SupplierSearchService,
  ) {}

  @Get("search")
  async searchParts(@Query() query: unknown, @Req() request: FastifyRequest) {
    // Per-IP throttle at the edge. Independent of this, RosskoSupplierProvider
    // enforces its own outbound cap so aggregate traffic across every IP
    // still cannot hammer the supplier once cache misses accumulate.
    await this.rateLimit.consume("supplier-search", request.ip, 60, 60);
    return this.search.search(query);
  }
}

@Public()
@Controller("suppliers/waitlist")
export class SupplierWaitlistController {
  constructor(
    private readonly rateLimit: RateLimitService,
    private readonly waitlist: SupplierWaitlistService,
  ) {}

  @Post()
  async create(@Body() body: unknown, @Req() request: FastifyRequest) {
    const contact = typeof body === "object" && body !== null && "contact" in body
      && typeof body.contact === "object" && body.contact !== null && "email" in body.contact
      && typeof body.contact.email === "string" ? body.contact.email.toLowerCase() : request.ip;
    await Promise.all([
      this.rateLimit.consume("supplier-waitlist-ip", request.ip, 10, 3_600),
      this.rateLimit.consume("supplier-waitlist-contact", contact, 5, 3_600),
    ]);
    return this.waitlist.create(body, metadata(request));
  }
}

/** The night check of our own assortment against the supplier: how far it has got, and its switch. */
@Controller("staff/suppliers/cross-fill")
export class StaffSupplierCrossFillController {
  constructor(private readonly crossFill: SupplierCrossFillService) {}

  // Not catalog:read: every customer holds that permission.
  @RequirePermissions("catalog:write")
  @Get()
  status() {
    return this.crossFill.status();
  }

  @RequirePermissions("catalog:write")
  @Post("switch")
  switch(@Body() body: unknown, @Req() request: FastifyRequest) {
    const enabled = typeof body === "object" && body !== null && "enabled" in body ? body.enabled : undefined;
    if (typeof enabled !== "boolean") throw new BadRequestException({ code: "invalid_cross_fill_switch", error: "Укажите, включить или выключить проверку." });
    return this.crossFill.setEnabled(enabled, request.authContext!, metadata(request));
  }
}

@Controller("staff/supplier-waitlist")
export class StaffSupplierWaitlistController {
  constructor(private readonly waitlist: SupplierWaitlistService) {}

  @RequirePermissions("requests:read:any")
  @Get()
  list(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.waitlist.list(query, request.authContext!);
  }

  @RequirePermissions("requests:read:any")
  @Get(":requestId")
  detail(@Param("requestId") requestId: string) {
    return this.waitlist.detail(requestId);
  }

  @RequirePermissions("requests:update:any")
  @Patch(":requestId")
  update(
    @Param("requestId") requestId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.waitlist.update(requestId, body, request.authContext!, metadata(request));
  }
}
