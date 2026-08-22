import { createHmac, randomUUID } from "node:crypto";

import { NestFactory } from "@nestjs/core";
import { Client } from "pg";

import {
  CHECKOUT_LEGAL_POLICY_VERSION,
  CHECKOUT_PERSONAL_DATA_CONSENT_VERSION,
  REGISTRATION_PERSONAL_DATA_CONSENT_VERSION,
} from "@an30/contracts";

import type { AuthContext } from "../auth/auth-context.js";
import { AppModule } from "../app.module.js";
import { OrderService } from "../checkout/order.service.js";
import { PaymentService } from "../checkout/payment.service.js";
import { validateEnvironment } from "../config.js";

interface JsonObject {
  [key: string]: unknown;
}

async function main(): Promise<void> {
  const environment = validateEnvironment(process.env);
  if (!environment.AUTH_DEBUG_TOKENS
    || environment.DEPLOYMENT_ENVIRONMENT !== "development"
    || environment.PAYMENTS_PROVIDER !== "sandbox"
    || !environment.ENABLE_PUBLIC_CHECKOUT) {
    throw new Error("Checkout smoke is restricted to local sandbox checkout");
  }
  if (!environment.SANDBOX_PAYMENT_WEBHOOK_SECRET) {
    throw new Error("Sandbox webhook secret is missing");
  }

  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const apiBase = "http://127.0.0.1:4000/api/v1";
  const customerEmail = `checkout-customer-${suffix}@example.invalid`;
  const customerPassword = "Checkout smoke password phrase 2026";
  const customerCookies = new Map<string, string>();
  const adminUserId = randomUUID();
  const warehouseId = randomUUID();
  const secondWarehouseId = randomUUID();
  const productIds = {
    competition: randomUUID(),
    multiWarehouse: randomUUID(),
    regular: randomUUID(),
  };
  const database = new Client({ connectionString: environment.DATABASE_URL });
  await database.connect();

  const parse = async (response: Response): Promise<JsonObject> => {
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text) as JsonObject; } catch { return { raw: text }; }
  };
  const request = async (
    path: string,
    init: RequestInit,
    expectedStatus: number,
    cookies?: Map<string, string>,
  ): Promise<JsonObject> => {
    const headers = new Headers(init.headers);
    if (cookies?.size) {
      headers.set("cookie", [...cookies].map(([key, value]) => `${key}=${value}`).join("; "));
    }
    const response = await fetch(`${apiBase}${path}`, { ...init, headers });
    if (cookies) {
      for (const cookie of response.headers.getSetCookie()) {
        const [pair] = cookie.split(";", 1);
        const separator = pair?.indexOf("=") ?? -1;
        if (pair && separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
    }
    const body = await parse(response);
    if (response.status !== expectedStatus) {
      throw new Error(`${path} returned ${response.status}, expected ${expectedStatus}: ${JSON.stringify(body)}`);
    }
    return body;
  };
  const post = (
    path: string,
    body: unknown,
    expectedStatus: number,
    extraHeaders: HeadersInit = {},
    cookies?: Map<string, string>,
  ) => request(path, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", origin: environment.APP_ORIGIN, ...extraHeaders },
    method: "POST",
  }, expectedStatus, cookies);
  const guestCheckout = (body: unknown, expectedStatus = 201) => (
    post("/checkout/guest", body, expectedStatus)
  );
  const complete = (checkout: JsonObject, expectedStatus = 200) => {
    const payment = checkout.payment as JsonObject;
    return post(
      String(payment.confirmationUrl).replace("/api/v1", ""),
      { confirmationToken: payment.confirmationToken },
      expectedStatus,
    );
  };
  const checkoutBody = (
    productId: string,
    scenario: "cancel" | "decline" | "success" | "timeout",
    idempotencyKey = randomUUID(),
    quantity = 1,
  ) => ({
    contact: {
      email: `buyer-${suffix}@example.invalid`,
      name: "Checkout Smoke Buyer",
      phone: "+79141234567",
    },
    delivery: { method: "pickup" },
    idempotencyKey,
    items: [{ productId, quantity }],
    legalPolicyVersion: CHECKOUT_LEGAL_POLICY_VERSION,
    personalDataConsent: true,
    personalDataConsentVersion: CHECKOUT_PERSONAL_DATA_CONSENT_VERSION,
    sandboxScenario: scenario,
    termsAccepted: true,
  });

  let application: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;
  let customerUserId: string | undefined;
  let smokeError: unknown;
  try {
    await database.query("BEGIN");
    await database.query(
      `INSERT INTO app.users (id,email,display_name,status,email_verified_at)
       VALUES ($1,$2,'Checkout Smoke Admin','active',clock_timestamp())`,
      [adminUserId, `checkout-admin-${suffix}@example.invalid`],
    );
    await database.query(
      `INSERT INTO app.staff_members (user_id,role,status,employee_code)
       VALUES ($1,'admin','active',$2)`,
      [adminUserId, `CHECKOUT-${suffix}`],
    );
    await database.query(
      `INSERT INTO app.warehouses (id,external_id,code,name)
       VALUES ($1,$2,$3,'Checkout smoke warehouse')`,
      [warehouseId, `checkout-warehouse-${suffix}`, `CHK-${suffix}`],
    );
    await database.query(
      `INSERT INTO app.warehouses (id,external_id,code,name)
       VALUES ($1,$2,$3,'Checkout smoke second warehouse')`,
      [secondWarehouseId, `checkout-warehouse-2-${suffix}`, `CHK2-${suffix}`],
    );
    for (const [kind, productId] of Object.entries(productIds)) {
      await database.query(
        `INSERT INTO app.products (id,external_id,sku,name,slug,is_active)
         VALUES ($1,$2,$3,$4,$5,true)`,
        [productId, `checkout-${kind}-${suffix}`, `CHK-${kind}-${suffix}`,
          `Checkout ${kind} ${suffix}`, `checkout-${kind}-${suffix}`],
      );
      await database.query(
        `INSERT INTO app.product_prices (product_id,amount_kopeks,currency,source)
         VALUES ($1,10000,'RUB','checkout-smoke')`,
        [productId],
      );
      await database.query(
        `INSERT INTO app.inventory_balances
          (product_id,warehouse_id,quantity_on_hand,quantity_reserved)
         VALUES ($1,$2,$3,0)`,
        [productId, warehouseId, kind === "competition" ? 1 : kind === "multiWarehouse" ? 5 : 20],
      );
      if (kind === "multiWarehouse") {
        await database.query(
          `INSERT INTO app.inventory_balances
            (product_id,warehouse_id,quantity_on_hand,quantity_reserved)
           VALUES ($1,$2,5,0)`,
          [productId, secondWarehouseId],
        );
      }
    }
    await database.query("COMMIT");

    application = await NestFactory.createApplicationContext(AppModule, { logger: false });
    const orders = application.get(OrderService);
    const payments = application.get(PaymentService);

    const registration = await post("/auth/register", {
      displayName: "Checkout Smoke Customer",
      email: customerEmail,
      password: customerPassword,
      personalDataConsent: true,
      personalDataConsentVersion: REGISTRATION_PERSONAL_DATA_CONSENT_VERSION,
    }, 202);
    const verificationToken = String(registration.developmentToken ?? "");
    if (!verificationToken) throw new Error("Customer verification token is missing");
    const verification = await post("/auth/email/verify", { token: verificationToken }, 201);
    customerUserId = String(verification.userId ?? "");
    const login = await post("/auth/login", {
      email: customerEmail,
      password: customerPassword,
    }, 201, {}, customerCookies);
    const csrfToken = String(login.csrfToken ?? "");
    const customerCheckout = await post(
      "/checkout",
      checkoutBody(productIds.regular, "cancel"),
      201,
      { "x-csrf-token": csrfToken },
      customerCookies,
    );
    await request(
      `/orders/${String((customerCheckout.order as JsonObject).id)}`,
      { method: "GET" },
      200,
      customerCookies,
    );
    await complete(customerCheckout);

    const successKey = randomUUID();
    const successRequest = checkoutBody(productIds.regular, "success", successKey, 2);
    const successCheckout = await guestCheckout(successRequest);
    const replay = await guestCheckout(successRequest);
    if (replay.idempotentReplay !== true
      || String((replay.order as JsonObject).id) !== String((successCheckout.order as JsonObject).id)) {
      throw new Error("Checkout replay was not idempotent");
    }
    if (replay.guestAccessToken !== successCheckout.guestAccessToken
      || (replay.payment as JsonObject).confirmationToken
        !== (successCheckout.payment as JsonObject).confirmationToken) {
      throw new Error("Checkout replay did not reproduce its guest and payment credentials");
    }
    await guestCheckout({ ...successRequest, items: [{ productId: productIds.regular, quantity: 3 }] }, 409);
    const successOrderId = String((successCheckout.order as JsonObject).id);
    await request(`/orders/guest/${successOrderId}`, {
      headers: { "x-guest-order-token": "wrong-guest-token-that-is-long-enough-for-check" },
      method: "GET",
    }, 404);
    await request(`/orders/guest/${successOrderId}`, {
      headers: { "x-guest-order-token": String(successCheckout.guestAccessToken) },
      method: "GET",
    }, 200);

    const multiWarehouse = await guestCheckout(
      checkoutBody(productIds.multiWarehouse, "cancel", randomUUID(), 8),
    );
    const multiReservationId = String((multiWarehouse.reservation as JsonObject).id);
    const allocations = await database.query<{ count: string; quantity: string }>(
      `SELECT count(*)::text AS count,sum(quantity)::text AS quantity
       FROM app.stock_reservation_items WHERE reservation_id=$1`,
      [multiReservationId],
    );
    if (allocations.rows[0]?.count !== "2" || allocations.rows[0]?.quantity !== "8") {
      throw new Error("Multi-warehouse reservation was not split deterministically");
    }
    await complete(multiWarehouse);
    await post("/payments/webhooks/sandbox", {
      amountKopeks: 20_000,
      externalEventId: `invalid-signature-${suffix}`,
      externalPaymentId: String((successCheckout.payment as JsonObject).externalPaymentId),
      status: "succeeded",
    }, 401, { "x-an30-sandbox-signature": "invalid-signature" });
    const validWebhook = {
      amountKopeks: 20_000,
      externalEventId: `valid-webhook-${suffix}`,
      externalPaymentId: String((successCheckout.payment as JsonObject).externalPaymentId),
      status: "succeeded",
    } as const;
    const webhookSignature = createHmac("sha256", environment.SANDBOX_PAYMENT_WEBHOOK_SECRET)
      .update(JSON.stringify(validWebhook), "utf8")
      .digest("base64url");
    const succeeded = await post(
      "/payments/webhooks/sandbox", validWebhook, 200,
      { "x-an30-sandbox-signature": webhookSignature },
    );
    if (succeeded.status !== "succeeded") throw new Error("Sandbox success did not succeed");
    const repeatedWebhook = await post(
      "/payments/webhooks/sandbox", validWebhook, 200,
      { "x-an30-sandbox-signature": webhookSignature },
    );
    if (repeatedWebhook.idempotentReplay !== true) throw new Error("Repeated webhook was not idempotent");
    const alternateEvent = await complete(successCheckout);
    if (alternateEvent.status !== "succeeded") throw new Error("Second success event changed payment state");
    const alternateReplay = await complete(successCheckout);
    if (alternateReplay.idempotentReplay !== true) throw new Error("Confirmation replay was not idempotent");

    const paymentId = String((successCheckout.payment as JsonObject).id);
    const fakeAdmin: AuthContext = {
      csrfTokenHash: Buffer.alloc(32),
      email: `checkout-admin-${suffix}@example.invalid`,
      mfaSetupRequired: false,
      mfaVerified: true,
      role: "admin",
      sessionId: randomUUID(),
      userId: adminUserId,
    };
    const partialKey = randomUUID();
    const partial = await payments.refund(paymentId, {
      amountKopeks: 5_000,
      idempotencyKey: partialKey,
      reason: "Checkout smoke partial refund",
    }, fakeAdmin, {});
    if (partial.paymentStatus !== "partially_refunded") throw new Error("Partial refund failed");
    const partialReplay = await payments.refund(paymentId, {
      amountKopeks: 5_000,
      idempotencyKey: partialKey,
      reason: "Checkout smoke partial refund",
    }, fakeAdmin, {});
    if (partialReplay.idempotentReplay !== true) throw new Error("Refund replay was not idempotent");
    const fullRefundKey = randomUUID();
    const full = await payments.refund(paymentId, {
      amountKopeks: 15_000,
      idempotencyKey: fullRefundKey,
      reason: "Checkout smoke final refund",
    }, fakeAdmin, {});
    if (full.paymentStatus !== "refunded") throw new Error("Full refund failed");
    const fullReplay = await payments.refund(paymentId, {
      amountKopeks: 15_000,
      idempotencyKey: fullRefundKey,
      reason: "Checkout smoke final refund",
    }, fakeAdmin, {});
    if (fullReplay.idempotentReplay !== true) throw new Error("Full refund replay was not idempotent");

    const deliveryCheckout = await guestCheckout(checkoutBody(productIds.regular, "success"));
    const deliveryGoodsResult = await complete(deliveryCheckout);
    if (deliveryGoodsResult.status !== "succeeded") throw new Error("Delivery order goods payment failed");
    const deliveryOrderId = String((deliveryCheckout.order as JsonObject).id);
    const deliveryGuestToken = String(deliveryCheckout.guestAccessToken);
    const paidDeliveryOrder = await request(`/orders/guest/${deliveryOrderId}`, {
      headers: { "x-guest-order-token": deliveryGuestToken }, method: "GET",
    }, 200);
    const awaiting = await orders.updateStatus(deliveryOrderId, {
      reason: "Delivery terms require a separate payment",
      status: "awaiting_delivery_terms",
      version: Number(paidDeliveryOrder.version),
    }, fakeAdmin, {});
    if (awaiting.status !== "awaiting_delivery_terms") throw new Error("Delivery state transition failed");
    const deliveryPaymentKey = randomUUID();
    const deliveryPaymentRequest = {
      amountKopeks: 3_000,
      idempotencyKey: deliveryPaymentKey,
      sandboxScenario: "success",
    } as const;
    const deliveryPayment = await orders.createDeliveryPayment(
      deliveryOrderId, deliveryPaymentRequest, fakeAdmin, {},
    );
    const deliveryReplay = await orders.createDeliveryPayment(
      deliveryOrderId, deliveryPaymentRequest, fakeAdmin, {},
    );
    if (deliveryReplay.idempotentReplay !== true) throw new Error("Delivery payment replay failed");
    const deliveryPaymentResult = await complete({ payment: deliveryPayment });
    if (deliveryPaymentResult.status !== "succeeded") throw new Error("Separate delivery payment failed");
    const deliveryOrder = await request(`/orders/guest/${deliveryOrderId}`, {
      headers: { "x-guest-order-token": deliveryGuestToken }, method: "GET",
    }, 200);
    if (deliveryOrder.totalAmountKopeks !== 13_000 || deliveryOrder.paidAmountKopeks !== 13_000) {
      throw new Error("Separate delivery amount was not reflected in the order");
    }

    const competition = await Promise.all([
      fetch(`${apiBase}/checkout/guest`, {
        body: JSON.stringify(checkoutBody(productIds.competition, "cancel")),
        headers: { "content-type": "application/json", origin: environment.APP_ORIGIN },
        method: "POST",
      }),
      fetch(`${apiBase}/checkout/guest`, {
        body: JSON.stringify(checkoutBody(productIds.competition, "cancel")),
        headers: { "content-type": "application/json", origin: environment.APP_ORIGIN },
        method: "POST",
      }),
    ]);
    const competitionStatuses = competition.map((response) => response.status).sort();
    if (competitionStatuses[0] !== 201 || competitionStatuses[1] !== 409) {
      throw new Error(`Last-unit competition returned ${competitionStatuses.join(",")}`);
    }
    const winnerResponse = competition.find((response) => response.status === 201)!;
    const winner = await parse(winnerResponse);
    await complete(winner);

    const declined = await guestCheckout(checkoutBody(productIds.regular, "decline"));
    const declinedResult = await complete(declined);
    if (declinedResult.status !== "failed") throw new Error("Sandbox decline did not fail");

    const timedOut = await guestCheckout(checkoutBody(productIds.regular, "timeout"));
    const timeoutResult = await complete(timedOut);
    if (timeoutResult.timedOut !== true || timeoutResult.status !== "pending") {
      throw new Error("Sandbox timeout did not remain pending");
    }
    const timeoutReservationId = String((timedOut.reservation as JsonObject).id);
    await database.query(
      `UPDATE app.stock_reservations
       SET created_at=clock_timestamp()-interval '2 hours',
           expires_at=clock_timestamp()-interval '1 second'
       WHERE id=$1`,
      [timeoutReservationId],
    );
    const expired = await database.query<{ count: number }>(
      "SELECT app.expire_stock_reservations(100) AS count",
    );
    if ((expired.rows[0]?.count ?? 0) < 1) throw new Error("Expired reservation was not released");

    const invariant = (await database.query<{
      active_competition: string;
      active_timeout: string;
      competition_on_hand: number;
      competition_reserved: number;
      regular_reserved: number;
    }>(
      `SELECT
         (SELECT count(*)::text FROM app.stock_reservations
          WHERE id=$1 AND status='active') AS active_timeout,
         (SELECT count(*)::text FROM app.stock_reservations AS reservation
          JOIN app.stock_reservation_items AS item ON item.reservation_id=reservation.id
          WHERE item.product_id=$2 AND reservation.status='active') AS active_competition,
         competition.quantity_on_hand AS competition_on_hand,
         competition.quantity_reserved AS competition_reserved,
         regular.quantity_reserved AS regular_reserved
       FROM app.inventory_balances AS competition
       JOIN app.inventory_balances AS regular ON regular.warehouse_id=competition.warehouse_id
       WHERE competition.product_id=$2 AND regular.product_id=$3`,
      [timeoutReservationId, productIds.competition, productIds.regular],
    )).rows[0];
    if (!invariant || invariant.active_timeout !== "0" || invariant.active_competition !== "0"
      || invariant.competition_on_hand !== 1 || invariant.competition_reserved !== 0
      || invariant.regular_reserved !== 0) {
      throw new Error(`Inventory invariant failed: ${JSON.stringify(invariant)}`);
    }
  } catch (error) {
    smokeError = error;
  }

  let cleanupError: unknown;
  try {
    await database.query("BEGIN");
    await database.query(
      `UPDATE app.products SET is_active=false,deleted_at=clock_timestamp()
       WHERE id=ANY($1::uuid[])`,
      [Object.values(productIds)],
    );
    await database.query(
      "UPDATE app.warehouses SET is_active=false,deleted_at=clock_timestamp() WHERE id=ANY($1::uuid[])",
      [[warehouseId, secondWarehouseId]],
    );
    await database.query("DELETE FROM app.staff_members WHERE user_id=$1", [adminUserId]);
    await database.query(
      `UPDATE app.users SET email='deleted+'||id::text||'@example.invalid',
         display_name='Removed checkout smoke admin',password_hash=NULL,status='disabled',
         session_invalid_before=clock_timestamp(),deleted_at=clock_timestamp() WHERE id=$1`,
      [adminUserId],
    );
    if (customerUserId) {
      await database.query("DELETE FROM app.outbox_events WHERE aggregate_type='auth' AND aggregate_id=$1", [customerUserId]);
      await database.query("DELETE FROM app.auth_sessions WHERE user_id=$1", [customerUserId]);
      await database.query("DELETE FROM app.email_verification_tokens WHERE user_id=$1", [customerUserId]);
      await database.query("DELETE FROM app.password_reset_tokens WHERE user_id=$1", [customerUserId]);
      await database.query(
        `UPDATE app.users SET email='deleted+'||id::text||'@example.invalid',
           display_name='Removed checkout smoke customer',password_hash=NULL,status='disabled',
           session_invalid_before=clock_timestamp(),deleted_at=clock_timestamp() WHERE id=$1`,
        [customerUserId],
      );
    }
    await database.query("DELETE FROM app.auth_attempts WHERE email=$1", [customerEmail]);
    await database.query("COMMIT");
  } catch (error) {
    await database.query("ROLLBACK");
    cleanupError = error;
  }

  if (application) await application.close();
  await database.end();
  if (smokeError) throw smokeError;
  if (cleanupError) throw cleanupError;
  process.stdout.write(JSON.stringify({ event: "checkout.smoke.passed", tests: 36 }) + "\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Checkout smoke failed"}\n`);
  process.exitCode = 1;
});
