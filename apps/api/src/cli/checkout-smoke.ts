import { randomUUID } from "node:crypto";

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
import { validateEnvironment } from "../config.js";

interface JsonObject {
  [key: string]: unknown;
}

/**
 * Checkout now creates a заявка (manager request), not a payment: see
 * docs/CHECKOUT_AND_PAYMENTS.md. This smoke test exercises the same
 * server-side guarantees the old payment-flow version did -- server-read
 * price and stock, idempotent replay, guest order access, concurrent
 * last-unit handling -- minus everything that only existed to drive the
 * removed sandbox payment provider.
 */
async function main(): Promise<void> {
  const environment = validateEnvironment(process.env);
  if (!environment.AUTH_DEBUG_TOKENS
    || environment.DEPLOYMENT_ENVIRONMENT !== "development"
    || !environment.ENABLE_PUBLIC_CHECKOUT) {
    throw new Error("Checkout smoke is restricted to a local development checkout");
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
    scarce: randomUUID(),
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
  const checkoutBody = (
    productId: string,
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
        [productId, warehouseId,
          kind === "competition" ? 1 : kind === "multiWarehouse" ? 5 : kind === "scarce" ? 2 : 20],
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

    const registration = await post("/auth/register", {
      displayName: "Checkout Smoke Customer",
      email: customerEmail,
      password: customerPassword,
      personalDataConsent: true,
      personalDataConsentVersion: REGISTRATION_PERSONAL_DATA_CONSENT_VERSION,
    }, 202);
    const verificationToken = String(registration.developmentToken ?? "");
    if (!verificationToken) throw new Error("Customer verification token is missing");
    const verification = await post("/auth/email/verify", { token: verificationToken, password: customerPassword }, 201);
    customerUserId = String(verification.userId ?? "");
    const login = await post("/auth/login", {
      email: customerEmail,
      password: customerPassword,
    }, 201, {}, customerCookies);
    const csrfToken = String(login.csrfToken ?? "");

    // A signed-in customer's checkout produces a заявка a manager can see --
    // no payment, no reservation -- and the order is immediately readable
    // through the customer's own session.
    const customerCheckout = await post(
      "/checkout",
      checkoutBody(productIds.regular),
      201,
      { "x-csrf-token": csrfToken },
      customerCookies,
    );
    if ((customerCheckout.order as JsonObject).status !== "awaiting_confirmation") {
      throw new Error("Customer checkout did not land in awaiting_confirmation");
    }
    const customerOrderId = String((customerCheckout.order as JsonObject).id);
    const readBack = await request(`/orders/${customerOrderId}`, { method: "GET" }, 200, customerCookies);
    if (readBack.status !== "awaiting_confirmation") throw new Error("Заявка is not visible to its owner");

    // Price is re-read server-side: the request never carries a price, and a
    // client that tries to smuggle one through an order line is rejected
    // outright by the strict item schema rather than silently ignored.
    await post("/checkout", {
      ...checkoutBody(productIds.regular),
      items: [{ productId: productIds.regular, quantity: 1, unitPriceKopeks: 1 }],
    }, 400, { "x-csrf-token": csrfToken }, customerCookies);
    const expectedSubtotal = 10_000;
    if ((customerCheckout.order as JsonObject).subtotalKopeks !== expectedSubtotal) {
      throw new Error("Order subtotal did not come from the server-side price");
    }

    // Guest checkout: idempotent replay returns the same заявка and guest
    // access credential, a conflicting payload under the same key is
    // rejected, and the guest order is only readable with the right token.
    const successKey = randomUUID();
    const successRequest = checkoutBody(productIds.regular, successKey, 2);
    const successCheckout = await guestCheckout(successRequest);
    const replay = await guestCheckout(successRequest);
    if (replay.idempotentReplay !== true
      || String((replay.order as JsonObject).id) !== String((successCheckout.order as JsonObject).id)) {
      throw new Error("Checkout replay was not idempotent -- a double submit created a second order");
    }
    if (replay.guestAccessToken !== successCheckout.guestAccessToken) {
      throw new Error("Checkout replay did not reproduce its guest access credential");
    }
    await guestCheckout({ ...successRequest, items: [{ productId: productIds.regular, quantity: 3 }] }, 409);
    const successOrderId = String((successCheckout.order as JsonObject).id);
    await request(`/orders/guest/${successOrderId}`, {
      headers: { "x-guest-order-token": "wrong-guest-token-that-is-long-enough-for-check" },
      method: "GET",
    }, 404);
    const guestOrder = await request(`/orders/guest/${successOrderId}`, {
      headers: { "x-guest-order-token": String(successCheckout.guestAccessToken) },
      method: "GET",
    }, 200);
    if (guestOrder.status !== "awaiting_confirmation") throw new Error("Guest заявка is not readable by its owner");

    // A manager confirms the заявка by moving it forward; the transition is
    // audited and the order stays visible throughout.
    const fakeAdmin: AuthContext = {
      csrfTokenHash: Buffer.alloc(32),
      email: `checkout-admin-${suffix}@example.invalid`,
      mfaSetupRequired: false,
      mfaVerified: true,
      role: "admin",
      sessionId: randomUUID(),
      userId: adminUserId,
    };
    const confirmed = await orders.updateStatus(successOrderId, {
      reason: "Manager confirmed by phone",
      status: "processing",
      version: Number(guestOrder.version),
    }, fakeAdmin, {});
    if (confirmed.status !== "processing") throw new Error("Manager confirmation did not move the заявка forward");

    // Stock is split across two warehouses; the server must sum availability
    // across both rather than checking only one.
    const multiWarehouse = await guestCheckout(checkoutBody(productIds.multiWarehouse, randomUUID(), 8));
    if ((multiWarehouse.order as JsonObject).status !== "awaiting_confirmation") {
      throw new Error("Multi-warehouse заявка was not created");
    }
    await guestCheckout(checkoutBody(productIds.scarce, randomUUID(), 3), 409);

    // No payment means no reservation to hold the last unit either: two
    // concurrent заявки for the same last unit both succeed, and it is the
    // manager -- not the software -- who resolves the conflict on the call.
    // This is a deliberate trade-off, not an oversight: see checkout.service.ts.
    const competition = await Promise.all([
      fetch(`${apiBase}/checkout/guest`, {
        body: JSON.stringify(checkoutBody(productIds.competition)),
        headers: { "content-type": "application/json", origin: environment.APP_ORIGIN },
        method: "POST",
      }),
      fetch(`${apiBase}/checkout/guest`, {
        body: JSON.stringify(checkoutBody(productIds.competition)),
        headers: { "content-type": "application/json", origin: environment.APP_ORIGIN },
        method: "POST",
      }),
    ]);
    const competitionStatuses = competition.map((response) => response.status).sort();
    if (competitionStatuses[0] !== 201 || competitionStatuses[1] !== 201) {
      throw new Error(`Unheld last-unit заявки returned ${competitionStatuses.join(",")}, expected both to succeed`);
    }

    // No app.payments row is ever created: the table itself no longer
    // exists, so this is enforced by the schema rather than tested here.
    const paymentTable = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM information_schema.tables
       WHERE table_schema='app' AND table_name='payments'`,
    );
    if (paymentTable.rows[0]?.count !== "0") throw new Error("app.payments still exists");
  } catch (error) {
    smokeError = error;
  }

  let cleanupError: unknown;
  try {
    await database.query("BEGIN");
    // Orders, order items and order status history are append-only by
    // design (see the *_immutable / *_append_only triggers in
    // 0001_initial_schema.sql) -- exactly like the payment-flow version of
    // this script, the заявки created here are intentionally left in place
    // rather than deleted.
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
  process.stdout.write(JSON.stringify({ event: "checkout.smoke.passed", tests: 16 }) + "\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Checkout smoke failed"}\n`);
  process.exitCode = 1;
});
