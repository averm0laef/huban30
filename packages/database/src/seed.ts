import { Client } from "pg";

import { getDatabaseConfig } from "./config.js";
import { log } from "./logger.js";
import { assertDevelopmentSeedAllowed } from "./seed-guard.js";

const seedSql = `
  INSERT INTO app.brands (id, external_id, name, slug, is_active, source_version)
  VALUES (
    '10000000-0000-4000-8000-000000000001',
    'dev-brand-an30',
    'АН-30 Demo',
    'an30-demo',
    true,
    1
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    is_active = EXCLUDED.is_active,
    source_version = EXCLUDED.source_version;

  INSERT INTO app.categories (id, external_id, name, slug, description, is_active, source_version)
  VALUES (
    '20000000-0000-4000-8000-000000000001',
    'dev-category-consumables',
    'Демонстрационные расходники',
    'demo-consumables',
    'Только для локальной разработки. Не является реальным каталогом.',
    true,
    1
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_active = EXCLUDED.is_active,
    source_version = EXCLUDED.source_version;

  INSERT INTO app.warehouses (id, external_id, code, name, is_active)
  VALUES (
    '30000000-0000-4000-8000-000000000001',
    'dev-warehouse-main',
    'DEV-MAIN',
    'Демонстрационный склад',
    true
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    is_active = EXCLUDED.is_active;

  INSERT INTO app.products (
    id,
    external_id,
    sku,
    name,
    slug,
    brand_id,
    category_id,
    description,
    attributes,
    search_text,
    is_active,
    is_demo,
    source_version
  )
  VALUES
    (
      '40000000-0000-4000-8000-000000000001',
      'dev-product-oil-filter',
      'DEMO-FILTER-001',
      'Демонстрационный масляный фильтр',
      'demo-oil-filter',
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'Тестовая запись для проверки интерфейса. Не продавать.',
      '{"demo": true, "warning": "not-for-sale"}'::jsonb,
      'демо фильтр масляный',
      true,
      true,
      1
    ),
    (
      '40000000-0000-4000-8000-000000000002',
      'dev-product-brake-pad',
      'DEMO-PAD-002',
      'Демонстрационные тормозные колодки',
      'demo-brake-pads',
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'Тестовая запись для проверки интерфейса. Не продавать.',
      '{"demo": true, "warning": "not-for-sale"}'::jsonb,
      'демо колодки тормозные',
      true,
      true,
      1
    )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    attributes = EXCLUDED.attributes,
    search_text = EXCLUDED.search_text,
    is_active = EXCLUDED.is_active,
    is_demo = EXCLUDED.is_demo,
    source_version = EXCLUDED.source_version;

  INSERT INTO app.product_prices (
    id,
    product_id,
    amount_kopeks,
    currency,
    valid_from,
    source
  )
  VALUES
    (
      '50000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      125000,
      'RUB',
      '2026-01-01 00:00:00+00',
      'dev_seed'
    ),
    (
      '50000000-0000-4000-8000-000000000002',
      '40000000-0000-4000-8000-000000000002',
      375000,
      'RUB',
      '2026-01-01 00:00:00+00',
      'dev_seed'
    )
  ON CONFLICT (id) DO UPDATE SET
    amount_kopeks = EXCLUDED.amount_kopeks,
    currency = EXCLUDED.currency,
    source = EXCLUDED.source;

  INSERT INTO app.inventory_balances (
    product_id,
    warehouse_id,
    quantity_on_hand,
    quantity_reserved,
    source_version
  )
  VALUES
    (
      '40000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      5,
      0,
      1
    ),
    (
      '40000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000001',
      2,
      0,
      1
    )
  ON CONFLICT (product_id, warehouse_id) DO UPDATE SET
    quantity_on_hand = EXCLUDED.quantity_on_hand,
    quantity_reserved = 0,
    source_version = EXCLUDED.source_version;
`;

async function main(): Promise<void> {
  assertDevelopmentSeedAllowed();
  const client = new Client(getDatabaseConfig());
  await client.connect();

  try {
    const deployment = await client.query<{ environment: string }>(
      "SELECT environment FROM app.deployment_settings WHERE singleton",
    );
    if (deployment.rows[0]?.environment !== "development") {
      throw new Error("Development seed is blocked by the database environment marker");
    }

    const database = await client.query<{ database_name: string }>(
      "SELECT current_database() AS database_name",
    );
    log("info", "seed.started", { database: database.rows[0]?.database_name });
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL lock_timeout = '10s'");
      await client.query(seedSql);
      await client.query(`
        INSERT INTO app.audit_log (action, entity_type, metadata)
        VALUES ('dev.seed.applied', 'development_catalog', '{"demo_only": true}'::jsonb)
      `);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    log("info", "seed.completed", { demoProducts: 2 });
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  log("error", "seed.failed", {
    message: error instanceof Error ? error.message : "Unknown seed error",
  });
  process.exitCode = 1;
});
