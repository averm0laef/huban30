import { Body, Controller, Get, HttpCode, HttpException, Param, Post, Put, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import { Public, RequirePermissions, SkipCsrf } from "../auth/auth.decorators.js";
import { CatalogImportService } from "./catalog-import.service.js";
import { CatalogApplyService } from "./catalog-apply.service.js";
import { sha256 } from "./catalog-import.utils.js";
import { OneCIntegrationService } from "./one-c-integration.service.js";

function userAgent(request: FastifyRequest): string | undefined {
  const value = request.headers["user-agent"];
  return typeof value === "string" ? value : undefined;
}

@Controller("catalog")
export class CatalogImportController {
  constructor(
    private readonly applyService: CatalogApplyService,
    private readonly imports: CatalogImportService,
    private readonly oneC: OneCIntegrationService,
  ) {}

  @RequirePermissions("catalog:import")
  @Post("imports/:batchId/apply")
  apply(@Param("batchId") batchId: string, @Req() request: FastifyRequest) {
    return this.applyService.apply(batchId, request.authContext!, {
      ipAddress: request.ip,
      userAgent: userAgent(request),
    });
  }

  @RequirePermissions("catalog:import")
  @Post("imports/:batchId/rollback")
  rollback(@Param("batchId") batchId: string, @Req() request: FastifyRequest) {
    return this.applyService.rollback(batchId, request.authContext!, {
      ipAddress: request.ip,
      userAgent: userAgent(request),
    });
  }

  @RequirePermissions("catalog:import")
  @Get("imports")
  list(@Query() query: unknown) {
    return this.imports.list(query);
  }

  @RequirePermissions("catalog:import")
  @Get("imports/:batchId")
  preview(@Param("batchId") batchId: string, @Query() query: unknown) {
    return this.imports.preview(batchId, query);
  }

  @RequirePermissions("settings:manage")
  @Get("1c/settings")
  settings() {
    return this.oneC.getSettings();
  }

  @RequirePermissions("settings:manage")
  @Put("1c/settings")
  updateSettings(@Body() body: unknown, @Req() request: FastifyRequest) {
    return this.oneC.updateSettings(
      body,
      request.authContext!,
      request.ip,
      userAgent(request),
    );
  }

  @RequirePermissions("settings:manage")
  @Get("1c/requests")
  requestLog(@Query() query: unknown) {
    return this.oneC.listRequests(query);
  }
}

@Public()
@SkipCsrf()
@Controller("integrations/1c")
export class OneCMachineController {
  constructor(
    private readonly imports: CatalogImportService,
    private readonly oneC: OneCIntegrationService,
  ) {}

  @Post("imports")
  @HttpCode(201)
  async upload(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const authorization = request.headers.authorization;
    const startedAt = performance.now();
    const externalRequestId = body && typeof body === "object"
      && "externalBatchId" in body && typeof body.externalBatchId === "string"
      ? body.externalBatchId.slice(0, 128)
      : undefined;
    let payloadChecksum: Buffer | undefined;
    try {
      await this.oneC.authorize(authorization, request.ip);
      payloadChecksum = sha256(body);
      const result = await this.imports.upload(body);
      await this.oneC.recordRequest({
        batchId: typeof result.id === "string" ? result.id : undefined,
        details: { idempotentReplay: result.idempotentReplay === true },
        durationMs: Math.round(performance.now() - startedAt),
        externalRequestId,
        ipAddress: request.ip,
        operation: "catalog_import_upload",
        payloadChecksum,
        statusCode: 201,
        succeeded: true,
      });
      return result;
    } catch (error) {
      const statusCode = error instanceof HttpException ? error.getStatus() : 500;
      if (statusCode === 401) {
        reply.header("WWW-Authenticate", 'Basic realm="AN30 1C", charset="UTF-8"');
      }
      await this.oneC.recordRequest({
        details: { errorType: error instanceof Error ? error.constructor.name : "UnknownError" },
        durationMs: Math.round(performance.now() - startedAt),
        externalRequestId,
        ipAddress: request.ip,
        operation: "catalog_import_upload",
        payloadChecksum,
        statusCode,
        succeeded: false,
      });
      throw error;
    }
  }
}
