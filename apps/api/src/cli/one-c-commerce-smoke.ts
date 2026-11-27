import { createHash, randomBytes } from "node:crypto";

import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";
import { Client } from "pg";

import { validateEnvironment } from "../config.js";
import { EXCHANGE_WAREHOUSE_EXTERNAL_ID } from "../one-c-exchange/commerce-ml.parser.js";
import { readOneCExchangeOptions } from "../one-c-exchange/one-c-exchange-options.js";
import { buildBrandExternalId } from "../one-c-exchange/one-c-exchange-slug.js";
import { OneCExchangeTempStorageService } from "../one-c-exchange/one-c-exchange-temp-storage.service.js";
import { PasswordService } from "../security/password.service.js";
import {
  buildCommerceSmokeDeletionXml,
  tombstoneCommerceSmokeCatalogFixture,
} from "./one-c-commerce-smoke-fixtures.js";

interface IntegrationSnapshot {
  allowed_networks: string[];
  is_enabled: boolean;
  last_exchange_at: Date | null;
  last_exchange_summary: Record<string, unknown>;
  last_used_at: Date | null;
  secret_hash: Buffer | null;
  settings: Record<string, unknown>;
  username: string | null;
}

interface WarehouseSnapshot {
  code: string;
  deleted_at: Date | null;
  id: string;
  is_active: boolean;
  name: string;
  source_version: string;
}

const STAGING_HOST = "staging.an30.ru";
const CONFIRMATION = "ONE_C_COMMERCE_SMOKE_CONFIRM";
const LOCK_NAME = "an30-one-c-commerce-smoke-v1";

function normalizeReply(value: string): string {
  return value.replace(/\r\n?/gu, "\n").trim();
}

function requireReply(value: string, expected: string, operation: string): void {
  if (normalizeReply(value) !== expected) {
    throw new Error(`${operation} returned an unexpected CommerceML reply: ${JSON.stringify(value)}`);
  }
}

function networkForAddress(value: string): string {
  if (value.includes("/")) return value;
  return value.includes(":") ? `${value}/128` : `${value}/32`;
}

async function main(): Promise<void> {
  const environment = validateEnvironment(process.env);
  const base = new URL("/api/v1/integrations/1c/exchange", environment.APP_ORIGIN);
  if (
    environment.DEPLOYMENT_ENVIRONMENT !== "staging"
    || base.protocol !== "https:"
    || base.hostname !== STAGING_HOST
    || process.env[CONFIRMATION] !== STAGING_HOST
  ) {
    throw new Error(
      `CommerceML smoke is staging-only; require DEPLOYMENT_ENVIRONMENT=staging, https://${STAGING_HOST} and ${CONFIRMATION}=${STAGING_HOST}`,
    );
  }

  const suffix = `${Date.now().toString(36)}-${randomBytes(5).toString("hex")}`;
  const username = `commerce-smoke-${suffix}`;
  const password = randomBytes(32).toString("base64url");
  const basic = `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
  // The fixture is deliberately stable. Inventory events and exchange runs
  // are append-only evidence, so inventing a new product for every smoke
  // would create unbounded staging clutter and trying to DELETE that history
  // would correctly fail. Each run revives this one hidden fixture, verifies
  // it, and then tombstones it again through CommerceML itself.
  const brandName = "Commerce Smoke Staging";
  const external = {
    brand: buildBrandExternalId(brandName),
    brandName,
    category: "commerce-smoke-category-staging-v1",
    product: "commerce-smoke-product-staging-v1",
    sku: "CML-STAGING-SMOKE-V1",
  };
  const filenames = {
    catalog: `smoke/${suffix}/import.xml`,
    deletion: `smoke/${suffix}/import-deletion.xml`,
    offers: `smoke/${suffix}/offers.xml`,
  };
  const importXml = `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация xmlns="urn:1C.ru:commerceml_2" ВерсияСхемы="2.10" ДатаФормирования="${new Date().toISOString()}">
  <Классификатор><Ид>smoke-classifier</Ид><Группы><Группа>
    <Ид>${external.category}</Ид><Наименование>Smoke category</Наименование>
  </Группа></Группы></Классификатор>
  <Каталог СодержитТолькоИзменения="true"><Ид>smoke-catalog</Ид><Товары><Товар>
    <Ид>${external.product}</Ид><Наименование>CommerceML smoke product</Наименование><Артикул />
    <Описание>Temporary staging CommerceML smoke product</Описание>
    <Изготовитель><Наименование>${external.brandName}</Наименование></Изготовитель>
    <Группы><Ид>${external.category}</Ид></Группы>
    <ЗначенияРеквизитов><ЗначениеРеквизита><Наименование>Код</Наименование><Значение>${external.sku}</Значение></ЗначениеРеквизита></ЗначенияРеквизитов>
  </Товар></Товары></Каталог>
</КоммерческаяИнформация>`;
  const offersXml = `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация xmlns="urn:1C.ru:commerceml_2" ВерсияСхемы="2.10" ДатаФормирования="${new Date().toISOString()}">
  <ПакетПредложений СодержитТолькоИзменения="true"><Ид>smoke-offers#</Ид><Предложения><Предложение>
    <Ид>${external.product}</Ид><Артикул>${external.sku}</Артикул>
    <Цены><Цена><ЦенаЗаЕдиницу>1234.56</ЦенаЗаЕдиницу><Валюта>RUB</Валюта></Цена></Цены>
    <Количество>9</Количество>
  </Предложение></Предложения></ПакетПредложений>
</КоммерческаяИнформация>`;
  const deletionXml = buildCommerceSmokeDeletionXml(external);
  const landingChecksums = [importXml, offersXml].map((xml) => createHash("sha256").update(xml).digest());

  const database = new Client({ connectionString: environment.DATABASE_URL });
  await database.connect();
  await database.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [LOCK_NAME]);

  const tempStorage = new OneCExchangeTempStorageService(new ConfigService(environment));
  let originalIntegration: IntegrationSnapshot | undefined;
  let originalWarehouse: WarehouseSnapshot | undefined;
  let integrationSnapshotLoaded = false;
  let warehouseSnapshotLoaded = false;
  let temporarySettingsInstalled = false;
  let sessionToken: string | undefined;
  let smokeError: unknown;
  const cleanupErrors: unknown[] = [];

  const exchange = async (
    mode: "checkauth" | "file" | "import" | "init",
    options: { body?: Buffer; filename?: string; includeCookie?: boolean; method?: "GET" | "POST" } = {},
  ): Promise<string> => {
    const url = new URL(base);
    url.searchParams.set("type", "catalog");
    url.searchParams.set("mode", mode);
    if (options.filename) url.searchParams.set("filename", options.filename);
    const headers = new Headers();
    if (mode === "checkauth") headers.set("authorization", basic);
    if (options.includeCookie && sessionToken) headers.set("cookie", `an30_1c_exchange=${sessionToken}`);
    if (options.body) headers.set("content-type", "application/octet-stream");
    const response = await fetch(url, {
      // Node fetch accepts Buffer at runtime; the DOM BodyInit declaration in
      // this workspace does not include Node's Buffer extension.
      body: options.body as unknown as BodyInit,
      headers,
      method: options.method ?? "GET",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    if (response.status !== 200) {
      const detail = mode === "checkauth" ? "" : `: ${JSON.stringify(body)}`;
      throw new Error(`${mode} returned HTTP ${response.status}, expected 200${detail}`);
    }
    return body;
  };

  const upload = async (filename: string, xml: string): Promise<void> => {
    const content = Buffer.from(xml, "utf8");
    const chunkSize = Math.max(1, Math.ceil(content.length / 3));
    for (let offset = 0; offset < content.length; offset += chunkSize) {
      const reply = await exchange("file", {
        body: content.subarray(offset, Math.min(content.length, offset + chunkSize)),
        filename,
        includeCookie: true,
        method: "POST",
      });
      requireReply(reply, "success", `mode=file ${filename}`);
    }
  };

  const importToCompletion = async (filename: string): Promise<void> => {
    for (let poll = 0; poll < 30; poll += 1) {
      const reply = normalizeReply(await exchange("import", { filename, includeCookie: true }));
      if (reply === "success") return;
      if (!reply.startsWith("progress\n")) {
        throw new Error(`mode=import ${filename} failed: ${JSON.stringify(reply)}`);
      }
    }
    throw new Error(`mode=import ${filename} did not finish within 30 polls`);
  };

  try {
    const marker = (await database.query<{ environment: string }>(
      "SELECT environment FROM app.deployment_settings WHERE singleton",
    )).rows[0]?.environment;
    if (marker !== "staging") throw new Error(`Database marker is ${marker ?? "missing"}, expected staging`);

    originalIntegration = (await database.query<IntegrationSnapshot>(
      `SELECT is_enabled,username,secret_hash,allowed_networks::text[],settings,last_used_at,
              last_exchange_at,last_exchange_summary
       FROM app.integration_endpoints WHERE integration_key='one_c' FOR UPDATE`,
    )).rows[0];
    integrationSnapshotLoaded = true;
    if (originalIntegration?.is_enabled) {
      throw new Error("Refusing to interrupt an already-enabled staging 1C integration");
    }
    originalWarehouse = (await database.query<WarehouseSnapshot>(
      `SELECT id,code::text,name,is_active,source_version::text,deleted_at
       FROM app.warehouses WHERE external_id=$1`,
      [EXCHANGE_WAREHOUSE_EXTERNAL_ID],
    )).rows[0];
    warehouseSnapshotLoaded = true;

    const secretHash = Buffer.from(await new PasswordService().hash(password), "utf8");
    const logCursor = (await database.query<{ id: string }>(
      "SELECT COALESCE(max(id),0)::text AS id FROM app.integration_request_log",
    )).rows[0]?.id ?? "0";
    // Set before awaiting: if PostgreSQL commits but the connection drops
    // before acknowledging the statement, finally must still attempt the
    // disable/restore path.
    temporarySettingsInstalled = true;
    await database.query(
      `INSERT INTO app.integration_endpoints (
         integration_key,is_enabled,username,secret_hash,allowed_networks
       ) VALUES ('one_c',true,$1,$2,ARRAY['0.0.0.0/0','::/0']::cidr[])
       ON CONFLICT (integration_key) DO UPDATE SET
         is_enabled=true,username=EXCLUDED.username,secret_hash=EXCLUDED.secret_hash,
         allowed_networks=EXCLUDED.allowed_networks`,
      [username, secretHash],
    );

    const authReply = normalizeReply(await exchange("checkauth"));
    const [authStatus, cookieName, token] = authReply.split("\n");
    if (authStatus !== "success" || cookieName !== "an30_1c_exchange" || !token) {
      throw new Error(`Invalid checkauth reply: ${JSON.stringify(authReply)}`);
    }
    sessionToken = token;
    const observedIp = (await database.query<{ ip_address: string }>(
      `SELECT ip_address::text
       FROM app.integration_request_log
       WHERE id>$1::bigint AND integration_key='one_c' AND operation='exchange_checkauth'
         AND succeeded
       ORDER BY id DESC LIMIT 1`,
      [logCursor],
    )).rows[0]?.ip_address;
    if (!observedIp) throw new Error("Could not resolve the source IP observed by the staging API");
    await database.query(
      `UPDATE app.integration_endpoints SET allowed_networks=ARRAY[$2]::cidr[]
       WHERE integration_key='one_c' AND username=$1`,
      [username, networkForAddress(observedIp)],
    );

    const initReply = normalizeReply(await exchange("init", { includeCookie: true }));
    if (!/^zip=no\nfile_limit=\d+$/u.test(initReply)) {
      throw new Error(`Invalid init reply: ${JSON.stringify(initReply)}`);
    }
    await upload(filenames.catalog, importXml);
    await upload(filenames.offers, offersXml);
    await importToCompletion(filenames.catalog);
    await importToCompletion(filenames.offers);

    const landed = (await database.query<{
      amount_kopeks: string;
      description: string | null;
      quantity_on_hand: number;
      sku: string;
    }>(
      `SELECT product.sku::text,product.description,price.amount_kopeks::text,balance.quantity_on_hand
       FROM app.products AS product
       JOIN app.product_prices AS price ON price.product_id=product.id AND price.valid_to IS NULL AND price.currency='RUB'
       JOIN app.inventory_balances AS balance ON balance.product_id=product.id
       JOIN app.warehouses AS warehouse ON warehouse.id=balance.warehouse_id AND warehouse.external_id=$2
       WHERE product.external_id=$1 AND product.is_active AND product.deleted_at IS NULL`,
      [external.product, EXCHANGE_WAREHOUSE_EXTERNAL_ID],
    )).rows[0];
    // <Описание> reaches the site only when this base is set to publish it (one-c-exchange-options.ts).
    const expectedDescription = readOneCExchangeOptions(originalIntegration?.settings).publishDescriptions
      ? "Temporary staging CommerceML smoke product"
      : null;
    if (
      landed?.sku !== external.sku
      || landed.description !== expectedDescription
      || landed.amount_kopeks !== "123456"
      || landed.quantity_on_hand !== 9
    ) {
      throw new Error(`CommerceML rows did not land correctly: ${JSON.stringify(landed ?? null)}`);
    }
    const completedRuns = (await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM app.one_c_exchange_runs
       WHERE content_checksum IN ($1,$2) AND status='completed'`,
      landingChecksums,
    )).rows[0]?.count;
    if (completedRuns !== "2") throw new Error(`Expected two completed exchange runs, found ${completedRuns ?? "0"}`);

    await upload(filenames.deletion, deletionXml);
    await importToCompletion(filenames.deletion);
    const tombstone = (await database.query<{ deleted_at: Date | null; is_active: boolean }>(
      "SELECT is_active,deleted_at FROM app.products WHERE external_id=$1",
      [external.product],
    )).rows[0];
    if (tombstone?.is_active !== false || !tombstone.deleted_at) {
      throw new Error(`CommerceML deletion marker did not tombstone the smoke product: ${JSON.stringify(tombstone ?? null)}`);
    }
    const categoryTombstone = (await database.query<{ deleted_at: Date | null; is_active: boolean }>(
      "SELECT is_active,deleted_at FROM app.categories WHERE external_id=$1",
      [external.category],
    )).rows[0];
    if (categoryTombstone?.is_active !== false || !categoryTombstone.deleted_at) {
      throw new Error(
        `CommerceML deletion marker did not tombstone the smoke category: ${JSON.stringify(categoryTombstone ?? null)}`,
      );
    }
  } catch (error) {
    smokeError = error;
  } finally {
    // Disable the temporary credential first. Every later cleanup step may
    // fail independently, but no failure should leave the smoke endpoint live.
    if (temporarySettingsInstalled) {
      try {
        await database.query(
          `UPDATE app.integration_endpoints
           SET is_enabled=false,allowed_networks=ARRAY[]::cidr[]
           WHERE integration_key='one_c' AND username=$1`,
          [username],
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    if (sessionToken) {
      const redis = new Redis(environment.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
      try {
        await redis.connect();
        await redis.del(`an30:one-c-exchange:session:${sessionToken}`);
      } catch (error) {
        cleanupErrors.push(error);
      } finally {
        if (redis.status !== "end") await redis.quit().catch((error: unknown) => cleanupErrors.push(error));
      }
    }

    for (const filename of Object.values(filenames)) {
      try {
        await tempStorage.remove(filename);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    try {
      await database.query("BEGIN");
      // Fail-safe for an error before the deletion.xml round-trip. Historical
      // prices, inventory events and exchange runs are append-only by design;
      // preserve them and only guarantee that the fixture cannot leak into
      // the public catalog after this CLI returns.
      await tombstoneCommerceSmokeCatalogFixture(
        (sql, values) => database.query(sql, values),
        external,
      );
      const fixtureCategory = (await database.query<{ deleted_at: Date | null; is_active: boolean }>(
        "SELECT is_active,deleted_at FROM app.categories WHERE external_id=$1",
        [external.category],
      )).rows[0];
      if (fixtureCategory && (fixtureCategory.is_active || !fixtureCategory.deleted_at)) {
        cleanupErrors.push(new Error(
          "Refusing to leave the CommerceML smoke category active after cleanup",
        ));
      }
      const fixtureBrand = (await database.query<{ deleted_at: Date | null; is_active: boolean }>(
        "SELECT is_active,deleted_at FROM app.brands WHERE external_id=$1",
        [external.brand],
      )).rows[0];
      if (fixtureBrand && (fixtureBrand.is_active || !fixtureBrand.deleted_at)) {
        cleanupErrors.push(new Error(
          "Refusing to leave the CommerceML smoke brand active after cleanup",
        ));
      }
      if (warehouseSnapshotLoaded && originalWarehouse) {
        await database.query(
          `UPDATE app.warehouses SET code=$2,name=$3,is_active=$4,source_version=$5,deleted_at=$6
           WHERE id=$1`,
          [originalWarehouse.id, originalWarehouse.code, originalWarehouse.name, originalWarehouse.is_active,
            originalWarehouse.source_version, originalWarehouse.deleted_at],
        );
      }
      await database.query("COMMIT");
    } catch (error) {
      await database.query("ROLLBACK").catch(() => undefined);
      cleanupErrors.push(error);
    }

    try {
      if (!temporarySettingsInstalled || !integrationSnapshotLoaded) {
        // No temporary row was installed, so there is nothing to restore.
      } else if (originalIntegration) {
        const restored = await database.query(
          `UPDATE app.integration_endpoints SET
             is_enabled=$2,username=$3,secret_hash=$4,allowed_networks=$5::cidr[],settings=$6::jsonb,
             last_used_at=$7,last_exchange_at=$8,last_exchange_summary=$9::jsonb
           WHERE integration_key='one_c' AND username=$1`,
          [username, originalIntegration.is_enabled, originalIntegration.username, originalIntegration.secret_hash,
            originalIntegration.allowed_networks, JSON.stringify(originalIntegration.settings), originalIntegration.last_used_at,
            originalIntegration.last_exchange_at, JSON.stringify(originalIntegration.last_exchange_summary)],
        );
        if (restored.rowCount !== 1) {
          cleanupErrors.push(new Error("Temporary 1C settings changed concurrently; refusing to overwrite them"));
        }
      } else {
        await database.query(
          "DELETE FROM app.integration_endpoints WHERE integration_key='one_c' AND username=$1",
          [username],
        );
      }
    } catch (error) {
      cleanupErrors.push(error);
    }

    await database.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [LOCK_NAME]).catch((error) => {
      cleanupErrors.push(error);
    });
    await database.end();
  }

  if (smokeError && cleanupErrors.length > 0) {
    throw new AggregateError([smokeError, ...cleanupErrors], "CommerceML smoke failed and cleanup was incomplete");
  }
  if (smokeError) throw smokeError;
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "CommerceML smoke passed but cleanup did not complete");
  }
  process.stdout.write(JSON.stringify({ event: "one-c-commerce.smoke.passed", host: base.hostname, tests: 9 }) + "\n");
}

function describeError(error: unknown): string {
  if (error instanceof AggregateError) {
    return [error.message, ...error.errors.map(describeError)].join("; ");
  }
  return error instanceof Error ? error.message : "CommerceML smoke failed";
}

main().catch((error: unknown) => {
  process.stderr.write(`${describeError(error)}\n`);
  process.exitCode = 1;
});
