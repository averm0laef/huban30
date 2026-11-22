import { Body, Controller, Delete, Get, HttpCode, HttpException, Param, Post, Put, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import { Public, RequirePermissions, SkipCsrf } from "../auth/auth.decorators.js";
import { CatalogImportService } from "./catalog-import.service.js";
import { CatalogApplyService } from "./catalog-apply.service.js";
import { sha256 } from "./catalog-import.utils.js";
import { CatalogRecategorizeService } from "./catalog-recategorize.service.js";
import { OneCIntegrationService } from "./one-c-integration.service.js";
import { BadRequestException } from "@nestjs/common";
import { ONE_C_SOURCES, type OneCSource } from "../one-c-exchange/one-c-source.js";

function sourceKey(input:string|undefined):OneCSource {
  const source=input ?? "one_c";
  if(!(ONE_C_SOURCES as readonly string[]).includes(source)) throw new BadRequestException("Неизвестная база 1С");
  return source as OneCSource;
}

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
    private readonly recategorize: CatalogRecategorizeService,
  ) {}

  // 1С groups → storefront sections (one public tree; see migration 0036).
  @RequirePermissions("catalog:import")
  @Get("1c/groups")
  oneCGroups() {
    return this.recategorize.listGroups();
  }

  @RequirePermissions("catalog:import")
  @Put("1c/groups")
  mapOneCGroup(@Body() body: unknown, @Req() request: FastifyRequest) {
    return this.recategorize.setGroupMapping(body, request.authContext!, request.ip);
  }

  @RequirePermissions("catalog:import")
  @Get("uncategorized")
  uncategorized(@Query() query: unknown) {
    return this.recategorize.listUncategorized(query);
  }

  @RequirePermissions("catalog:import")
  @Post("recategorize")
  @HttpCode(200)
  recategorizeAll() {
    return this.recategorize.recategorizeAll();
  }

  /** What «Без категории» mostly consists of, by the word the names lead with. */
  @RequirePermissions("catalog:import")
  @Get("uncategorized/summary")
  uncategorizedSummary() {
    return this.recategorize.uncategorizedSummary();
  }

  // Staff sorting rules: «название начинается со слова …» → раздел.
  @RequirePermissions("catalog:import")
  @Get("placement-rules")
  placementRules() {
    return this.recategorize.listRules();
  }

  @RequirePermissions("catalog:import")
  @Post("placement-rules")
  @HttpCode(200)
  addPlacementRule(@Body() body: unknown, @Req() request: FastifyRequest) {
    return this.recategorize.addRule(body, request.authContext!, request.ip);
  }

  @RequirePermissions("catalog:import")
  @Delete("placement-rules/:ruleId")
  @HttpCode(200)
  removePlacementRule(@Param("ruleId") ruleId: string, @Req() request: FastifyRequest) {
    return this.recategorize.removeRule(ruleId, request.authContext!, request.ip);
  }

  /** One product's section chosen by hand; it stays through imports and re-sorting. */
  @RequirePermissions("catalog:import")
  @Put("products/:productId/category")
  @HttpCode(200)
  setProductCategory(@Param("productId") productId: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    return this.recategorize.setProductCategory(productId, body, request.authContext!, request.ip);
  }

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
  settings(@Query("source") source?:string) {
    return this.oneC.getSettings(sourceKey(source));
  }

  @RequirePermissions("settings:manage")
  @Put("1c/settings")
  updateSettings(@Body() body: unknown, @Req() request: FastifyRequest,@Query("source") source?:string) {
    return this.oneC.updateSettings(
      body,
      request.authContext!,
      request.ip,
      userAgent(request),
      sourceKey(source),
    );
  }

  @RequirePermissions("settings:manage")
  @Get("1c/requests")
  requestLog(@Query() query: Record<string,unknown>) {
    const {source,...filters}=query;
    return this.oneC.listRequests(filters,sourceKey(typeof source === "string" ? source:undefined));
  }

  @RequirePermissions("settings:manage") @Get("1c/sources") sources() { return this.oneC.getSources(); }

  // Standard «Обмен с сайтом» runs apply without a staff preview step, so
  // catalog staff (not only admins) need to see whether they succeeded.
  @RequirePermissions("catalog:import")
  @Get("1c/exchange-runs")
  exchangeRuns(@Query() query: Record<string, unknown>) {
    const { source, ...filters } = query;
    return this.oneC.listExchangeRuns(filters, sourceKey(typeof source === "string" ? source : undefined));
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
