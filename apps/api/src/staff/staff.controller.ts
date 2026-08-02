import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { RequirePermissions } from "../auth/auth.decorators.js";
import { StaffService } from "./staff.service.js";

function metadata(request: FastifyRequest) {
  const userAgent = request.headers["user-agent"];
  return {
    ipAddress: request.ip,
    userAgent: typeof userAgent === "string" ? userAgent : undefined,
  };
}

@Controller("staff")
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @RequirePermissions("orders:read:any")
  @Get("summary")
  summary(@Req() request: FastifyRequest) {
    return this.staff.summary(request.authContext!);
  }

  @RequirePermissions("orders:read:any")
  @Get("orders")
  orders(@Query() query: unknown) {
    return this.staff.orders(query);
  }

  @RequirePermissions("chat:manage:any")
  @Get("chats")
  chats(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.staff.chats(query, request.authContext!);
  }

  @RequirePermissions("requests:read:any")
  @Get("requests")
  requests(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.staff.requests(query, request.authContext!);
  }

  @RequirePermissions("requests:read:any")
  @Get("requests/:requestId")
  request(@Param("requestId") requestId: string, @Req() request: FastifyRequest) {
    return this.staff.request(requestId, request.authContext!, metadata(request));
  }

  @RequirePermissions("requests:update:any")
  @Patch("requests/:requestId")
  updateRequest(
    @Param("requestId") requestId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.staff.updateRequest(
      requestId,
      body,
      request.authContext!,
      metadata(request),
    );
  }

  @RequirePermissions("chat:manage:any")
  @Patch("chats/:threadId")
  updateChat(
    @Param("threadId") threadId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.staff.updateChat(
      threadId,
      body,
      request.authContext!,
      metadata(request),
    );
  }

  @RequirePermissions("catalog:read")
  @Get("catalog")
  catalog(@Query() query: unknown) {
    return this.staff.catalog(query);
  }

  @RequirePermissions("orders:read:any")
  @Get("invoices")
  invoices(@Query() query: unknown) {
    return this.staff.invoices(query);
  }

  @RequirePermissions("orders:update:any")
  @Post("invoices")
  createInvoice(@Body() body: unknown, @Req() request: FastifyRequest) {
    return this.staff.createInvoice(body, request.authContext!, metadata(request));
  }

  @RequirePermissions("orders:update:any")
  @Patch("invoices/:invoiceId")
  updateInvoice(
    @Param("invoiceId") invoiceId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.staff.updateInvoice(
      invoiceId,
      body,
      request.authContext!,
      metadata(request),
    );
  }

  @RequirePermissions("staff:read")
  @Get("team")
  team(@Query() query: unknown) {
    return this.staff.team(query);
  }

  @RequirePermissions("reports:read")
  @Get("reports")
  reports() {
    return this.staff.reports();
  }

  @RequirePermissions("audit:read")
  @Get("audit")
  audit(@Query() query: unknown) {
    return this.staff.audit(query);
  }
}
