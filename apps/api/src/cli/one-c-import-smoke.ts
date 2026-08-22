import { Client } from "pg";

import { validateEnvironment } from "../config.js";
import { TotpService } from "../security/totp.service.js";

type Json = Record<string, unknown>;

async function main(): Promise<void> {
  const environment = validateEnvironment(process.env);
  if (!environment.AUTH_DEBUG_TOKENS || !environment.APP_ORIGIN.startsWith("http://localhost")) {
    throw new Error("1C smoke is restricted to the local debug environment");
  }
  const apiBase = "http://127.0.0.1:4000/api/v1";
  const ownerEmail = "owner-one-c-smoke@example.invalid";
  const ownerPassword = "Owner 1C smoke password phrase 2026";
  const integrationUsername = "one-c-smoke";
  const integrationPassword = "One-C smoke integration password 2026";
  const suffix = Date.now().toString(36);
  const external = {
    brand: `smoke-brand-${suffix}`,
    category: `smoke-category-${suffix}`,
    product: `smoke-product-${suffix}`,
    warehouse: `smoke-warehouse-${suffix}`,
  };
  const cookies = new Map<string, string>();
  const totp = new TotpService();
  let csrf = "";
  let firstBatchId: string | undefined;
  let secondBatchId: string | undefined;
  let firstApplied = false;
  let secondApplied = false;

  const request = async (path: string, init: RequestInit, expectedStatus: number): Promise<Json> => {
    const headers = new Headers(init.headers);
    if (cookies.size > 0) {
      headers.set("cookie", [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; "));
    }
    const response = await fetch(`${apiBase}${path}`, { ...init, headers });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";", 1);
      const separator = pair?.indexOf("=") ?? -1;
      if (pair && separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    const body = response.status === 204 ? {} : await response.json() as Json;
    if (response.status !== expectedStatus) {
      throw new Error(`${path} returned ${response.status}, expected ${expectedStatus}: ${JSON.stringify(body)}`);
    }
    return body;
  };

  const post = (path: string, body: unknown, status: number) => request(path, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: environment.APP_ORIGIN,
      ...(csrf ? { "x-csrf-token": csrf } : {}),
    },
    method: "POST",
  }, status);
  const put = (path: string, body: unknown, status: number) => request(path, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: environment.APP_ORIGIN,
      ...(csrf ? { "x-csrf-token": csrf } : {}),
    },
    method: "PUT",
  }, status);
  const machineUpload = (body: unknown, status: number, forwardedIp?: string) => request(
    "/integrations/1c/imports",
    {
      body: JSON.stringify(body),
      headers: {
        authorization: `Basic ${Buffer.from(`${integrationUsername}:${integrationPassword}`, "utf8").toString("base64")}`,
        "content-type": "application/json",
        ...(forwardedIp ? { "x-forwarded-for": forwardedIp } : {}),
      },
      method: "POST",
    },
    status,
  );

  let smokeError: unknown;
  try {
    const login = await post("/auth/login", { email: ownerEmail, password: ownerPassword }, 201);
    csrf = String(login.csrfToken ?? "");
    const setup = await post("/auth/totp/setup", {}, 201);
    const confirmed = await post("/auth/totp/confirm", {
      code: totp.generateCode(String(setup.secret ?? "")),
    }, 201);
    csrf = String(confirmed.csrfToken ?? "");

    const settings = await put("/catalog/1c/settings", {
      allowedNetworks: ["127.0.0.1/32"],
      enabled: true,
      password: integrationPassword,
      username: integrationUsername,
    }, 200);
    if (settings.hasPassword !== true || "password" in settings || "secretCiphertext" in settings) {
      throw new Error("1C settings response exposed or lost the write-only password state");
    }
    await machineUpload({
      exportedAt: new Date().toISOString(), externalBatchId: `blocked-${suffix}`,
      rows: [{ entityType: "brand" }], schemaVersion: 1,
    }, 401, "203.0.113.25");

    const invalidEnvelope = {
      exportedAt: new Date().toISOString(),
      externalBatchId: `invalid-${suffix}`,
      rows: [
        { entityType: "brand", externalId: `invalid-brand-${suffix}`, isActive: true,
          name: "Invalid smoke brand", slug: `invalid-brand-${suffix}`, version: 1 },
        { amountKopeks: 12.5, entityType: "price", productExternalId: "missing", version: 1 },
      ],
      schemaVersion: 1,
    };
    const invalid = await machineUpload(invalidEnvelope, 201);
    if (invalid.invalidRows !== 1 || invalid.validRows !== 1) {
      throw new Error("Partially damaged batch was not isolated row-by-row");
    }
    await post(`/catalog/imports/${String(invalid.id)}/apply`, {}, 409);

    const firstEnvelope = {
      exportedAt: new Date().toISOString(),
      externalBatchId: `valid-1-${suffix}`,
      rows: [
        { entityType: "brand", externalId: external.brand, isActive: true,
          name: "Smoke Brand", slug: external.brand, version: 1 },
        { description: null, entityType: "category", externalId: external.category,
          isActive: true, name: "Smoke Category", parentExternalId: null,
          slug: external.category, sortOrder: 10, version: 1 },
        { code: `S-${suffix}`, entityType: "warehouse", externalId: external.warehouse,
          isActive: true, name: "Smoke Warehouse", version: 1 },
        { attributes: { fitment: "smoke" }, brandExternalId: external.brand,
          categoryExternalId: external.category, description: "Initial description",
          entityType: "product", externalId: external.product, isActive: true,
          name: "Smoke Product v1", searchText: "smoke product", sku: `SKU-${suffix}`,
          slug: external.product, version: 1 },
        { amountKopeks: 123_45, entityType: "price", productExternalId: external.product,
          version: 1 },
        { entityType: "stock", productExternalId: external.product, quantityOnHand: 7,
          version: 1, warehouseExternalId: external.warehouse },
      ],
      schemaVersion: 1,
    };
    const first = await machineUpload(firstEnvelope, 201);
    firstBatchId = String(first.id ?? "");
    if (!firstBatchId || first.validRows !== 6 || first.invalidRows !== 0) {
      throw new Error("Valid 1C batch preview contract is invalid");
    }
    const replay = await machineUpload(firstEnvelope, 201);
    if (replay.id !== firstBatchId || replay.idempotentReplay !== true) {
      throw new Error("Repeated 1C upload was not idempotent");
    }
    await machineUpload({
      ...firstEnvelope,
      exportedAt: new Date(Date.now() + 1_000).toISOString(),
    }, 409);
    const preview = await request(`/catalog/imports/${firstBatchId}?limit=20`, { method: "GET" }, 200);
    if ((preview.page as { rows?: unknown[] } | undefined)?.rows?.length !== 6) {
      throw new Error("1C preview did not return six validated rows");
    }
    const appliedFirst = await post(`/catalog/imports/${firstBatchId}/apply`, {}, 201);
    firstApplied = true;
    if (appliedFirst.appliedRows !== 6) throw new Error("First revision did not apply all rows");
    const appliedReplay = await post(`/catalog/imports/${firstBatchId}/apply`, {}, 201);
    if (appliedReplay.idempotentReplay !== true) throw new Error("Repeated apply was not idempotent");

    const noop = await machineUpload({
      ...firstEnvelope,
      exportedAt: new Date(Date.now() + 2_000).toISOString(),
      externalBatchId: `noop-${suffix}`,
    }, 201);
    if (noop.skippedRows !== 6 || noop.validRows !== 0) {
      throw new Error("Unchanged source versions were not classified as no-op rows");
    }
    await post(`/catalog/imports/${String(noop.id)}/apply`, {}, 201);
    await post(`/catalog/imports/${String(noop.id)}/rollback`, {}, 201);

    const reusedVersion = await machineUpload({
      exportedAt: new Date(Date.now() + 3_000).toISOString(),
      externalBatchId: `reused-version-${suffix}`,
      rows: [{
        attributes: { fitment: "smoke" }, brandExternalId: external.brand,
        categoryExternalId: external.category, description: "Conflicting description",
        entityType: "product", externalId: external.product, isActive: true,
        name: "Same version, different data", searchText: "conflict", sku: `SKU-${suffix}`,
        slug: external.product, version: 1,
      }],
      schemaVersion: 1,
    }, 201);
    if (reusedVersion.invalidRows !== 1) {
      throw new Error("Reused source version with changed payload was not rejected");
    }
    await post(`/catalog/imports/${String(reusedVersion.id)}/apply`, {}, 409);

    const secondEnvelope = {
      exportedAt: new Date().toISOString(),
      externalBatchId: `valid-2-${suffix}`,
      rows: [
        { attributes: { fitment: "smoke", revision: 2 }, brandExternalId: external.brand,
          categoryExternalId: external.category, description: "Updated description",
          entityType: "product", externalId: external.product, isActive: true,
          name: "Smoke Product v2", searchText: "smoke product updated", sku: `SKU-${suffix}`,
          slug: external.product, version: 2 },
        { amountKopeks: 150_00, entityType: "price", productExternalId: external.product,
          version: 2 },
        { entityType: "stock", productExternalId: external.product, quantityOnHand: 11,
          version: 2, warehouseExternalId: external.warehouse },
      ],
      schemaVersion: 1,
    };
    const second = await machineUpload(secondEnvelope, 201);
    secondBatchId = String(second.id ?? "");
    await post(`/catalog/imports/${secondBatchId}/apply`, {}, 201);
    secondApplied = true;

    const client = new Client({ connectionString: environment.DATABASE_URL });
    await client.connect();
    try {
      const updated = await client.query<{
        amount_kopeks: string; name: string; quantity_on_hand: number;
      }>(`SELECT product.name, price.amount_kopeks::text, balance.quantity_on_hand
          FROM app.products AS product
          JOIN app.product_prices AS price ON price.product_id=product.id AND price.valid_to IS NULL
          JOIN app.inventory_balances AS balance ON balance.product_id=product.id
          WHERE product.external_id=$1`, [external.product]);
      if (updated.rows[0]?.name !== "Smoke Product v2"
        || updated.rows[0].amount_kopeks !== "15000"
        || updated.rows[0].quantity_on_hand !== 11) {
        throw new Error("Second revision did not update product, price and stock atomically");
      }
    } finally {
      await client.end();
    }

    await post(`/catalog/imports/${secondBatchId}/rollback`, {}, 201);
    secondApplied = false;
    await post(`/catalog/imports/${firstBatchId}/rollback`, {}, 201);
    firstApplied = false;
    const requests = await request("/catalog/1c/requests?limit=100", { method: "GET" }, 200);
    if (!Array.isArray(requests.items) || requests.items.length < 4) {
      throw new Error("1C operation journal is incomplete");
    }
  } catch (error) {
    smokeError = error;
  }

  if (secondApplied && secondBatchId) {
    try { await post(`/catalog/imports/${secondBatchId}/rollback`, {}, 201); } catch { /* report original */ }
  }
  if (firstApplied && firstBatchId) {
    try { await post(`/catalog/imports/${firstBatchId}/rollback`, {}, 201); } catch { /* report original */ }
  }

  let cleanupError: unknown;
  const cleanup = new Client({ connectionString: environment.DATABASE_URL });
  await cleanup.connect();
  try {
    await cleanup.query("BEGIN");
    await cleanup.query(`UPDATE app.integration_endpoints
      SET is_enabled=false,username=NULL,secret_hash=NULL,allowed_networks=ARRAY[]::cidr[]
      WHERE integration_key='one_c'`);
    const account = (await cleanup.query<{ id: string }>(
      "SELECT id FROM app.users WHERE email=$1", [ownerEmail],
    )).rows[0];
    if (account) {
      await cleanup.query("DELETE FROM app.auth_sessions WHERE user_id=$1", [account.id]);
      await cleanup.query("DELETE FROM app.staff_recovery_codes WHERE user_id=$1", [account.id]);
      await cleanup.query("DELETE FROM app.staff_members WHERE user_id=$1", [account.id]);
      await cleanup.query(`UPDATE app.users SET email='deleted+'||id::text||'@example.invalid',
        display_name='Removed 1C smoke owner',password_hash=NULL,status='disabled',
        session_invalid_before=clock_timestamp(),deleted_at=clock_timestamp() WHERE id=$1`, [account.id]);
    }
    await cleanup.query("DELETE FROM app.auth_attempts WHERE email=$1", [ownerEmail]);
    const active = await cleanup.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM app.products
       WHERE external_id=$1 AND deleted_at IS NULL`, [external.product],
    );
    if (active.rows[0]?.count !== "0") throw new Error("1C smoke catalog data remains active after rollback");
    await cleanup.query("COMMIT");
  } catch (error) {
    await cleanup.query("ROLLBACK");
    cleanupError = error;
  } finally {
    await cleanup.end();
  }

  if (smokeError) throw smokeError;
  if (cleanupError) throw cleanupError;
  process.stdout.write(JSON.stringify({ event: "one-c-import.smoke.passed", tests: 25 }) + "\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "1C import smoke failed"}\n`);
  process.exitCode = 1;
});
