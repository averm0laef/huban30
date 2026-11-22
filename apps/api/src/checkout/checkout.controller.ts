import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { Public, RequirePermissions } from "../auth/auth.decorators.js";
import { RateLimitService } from "../security/rate-limit.service.js";
import { CheckoutService } from "./checkout.service.js";
import { OrderService } from "./order.service.js";

function metadata(request: FastifyRequest) {
  const userAgent = request.headers["user-agent"];
  return { ipAddress: request.ip, userAgent: typeof userAgent === "string" ? userAgent : undefined };
}

@Controller("checkout")
export class CustomerCheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post()
  create(@Body() body: unknown, @Req() request: FastifyRequest) {
    return this.checkout.createForCustomer(body, request.authContext!, metadata(request));
  }
}

@Public()
@Controller("checkout/guest")
export class GuestCheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post()
  create(@Body() body: unknown, @Req() request: FastifyRequest) {
    return this.checkout.createForGuest(body, metadata(request));
  }
}

@Controller("orders")
export class OrdersController {
  constructor(private readonly orders: OrderService) {}

  @Get()
  list(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.orders.list(request.authContext!, query);
  }

  @Get(":orderId")
  read(@Param("orderId") orderId: string, @Req() request: FastifyRequest) {
    return this.orders.readForUser(orderId, request.authContext!);
  }

  @RequirePermissions("orders:update:any")
  @Patch(":orderId/status")
  updateStatus(
    @Param("orderId") orderId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.orders.updateStatus(orderId, body, request.authContext!, metadata(request));
  }
}

@Public()
@Controller("orders/guest")
export class GuestOrdersController {
  constructor(
    private readonly orders: OrderService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get(":orderId")
  async read(
    @Param("orderId") orderId: string,
    @Headers("x-guest-order-token") token: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    await Promise.all([
      this.rateLimit.consume("guest-order-ip", request.ip, 30, 60),
      this.rateLimit.consume("guest-order-token", token ?? "missing", 120, 60),
    ]);
    return this.orders.readForGuest(orderId, token);
  }
}
