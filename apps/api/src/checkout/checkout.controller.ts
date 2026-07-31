import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { Public, RequirePermissions, SkipCsrf } from "../auth/auth.decorators.js";
import { CheckoutService } from "./checkout.service.js";
import { OrderService } from "./order.service.js";
import { PaymentService } from "./payment.service.js";

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
  list(@Query("limit") limit: string | undefined, @Req() request: FastifyRequest) {
    return this.orders.list(request.authContext!, limit);
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

  @RequirePermissions("orders:update:any")
  @Post(":orderId/payments/delivery")
  createDeliveryPayment(
    @Param("orderId") orderId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.orders.createDeliveryPayment(orderId, body, request.authContext!, metadata(request));
  }
}

@Public()
@Controller("orders/guest")
export class GuestOrdersController {
  constructor(private readonly orders: OrderService) {}

  @Get(":orderId")
  read(
    @Param("orderId") orderId: string,
    @Headers("x-guest-order-token") token: string | undefined,
  ) {
    return this.orders.readForGuest(orderId, token);
  }
}

@Controller("payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentService) {}

  @RequirePermissions("payments:refund")
  @Post(":paymentId/refunds")
  refund(
    @Param("paymentId") paymentId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.payments.refund(paymentId, body, request.authContext!, metadata(request));
  }
}

@Public()
@Controller("payments/sandbox")
export class SandboxPaymentsController {
  constructor(private readonly payments: PaymentService) {}

  @Post(":externalPaymentId/complete")
  @HttpCode(200)
  complete(
    @Param("externalPaymentId") externalPaymentId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.payments.completeSandbox(externalPaymentId, body, request.ip);
  }
}

@Public()
@SkipCsrf()
@Controller("payments/webhooks")
export class PaymentWebhooksController {
  constructor(private readonly payments: PaymentService) {}

  @Post("sandbox")
  @HttpCode(200)
  sandbox(
    @Body() body: unknown,
    @Headers("x-an30-sandbox-signature") signature: string | undefined,
  ) {
    return this.payments.handleSandboxWebhook(body, signature);
  }
}
