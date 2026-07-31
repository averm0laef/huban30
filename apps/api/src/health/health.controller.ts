import { Controller, Get, Header, Res } from "@nestjs/common";
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";

import type { HealthResponse } from "@an30/contracts";

import { HealthService } from "./health.service.js";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get("live")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ description: "API process is alive" })
  live(): HealthResponse {
    return this.healthService.live();
  }

  @Get("ready")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ description: "PostgreSQL and Redis are available" })
  @ApiServiceUnavailableResponse({ description: "A required dependency is unavailable" })
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<HealthResponse> {
    const response = await this.healthService.ready();
    if (response.status !== "ok") reply.status(503);
    return response;
  }
}
