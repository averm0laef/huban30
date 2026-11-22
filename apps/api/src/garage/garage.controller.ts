import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { RequirePermissions } from "../auth/auth.decorators.js";
import { RateLimitService } from "../security/rate-limit.service.js";
import { GarageService } from "./garage.service.js";

@Controller("account/vehicles")
export class GarageController {
  constructor(
    private readonly garage: GarageService,
    private readonly limits: RateLimitService,
  ) {}

  @RequirePermissions("account:read:self")
  @Get()
  list(@Req() request: FastifyRequest) {
    return this.garage.list(request.authContext!);
  }

  @RequirePermissions("account:update:self")
  @Post()
  async add(@Body() body: unknown, @Req() request: FastifyRequest) {
    await this.limits.consume("garage-update", request.authContext!.userId, 40, 3_600);
    return this.garage.add(body, request.authContext!);
  }

  @RequirePermissions("account:update:self")
  @Put(":vehicleId/primary")
  @HttpCode(200)
  async makePrimary(@Param("vehicleId") vehicleId: string, @Req() request: FastifyRequest) {
    await this.limits.consume("garage-update", request.authContext!.userId, 40, 3_600);
    return this.garage.makePrimary(vehicleId, request.authContext!);
  }

  @RequirePermissions("account:update:self")
  @Delete(":vehicleId")
  @HttpCode(200)
  async remove(@Param("vehicleId") vehicleId: string, @Req() request: FastifyRequest) {
    await this.limits.consume("garage-update", request.authContext!.userId, 40, 3_600);
    return this.garage.remove(vehicleId, request.authContext!);
  }
}
