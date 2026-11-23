import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ONE_C_EXCHANGE_LATE_TOPIC, queueLateExchangeAlerts } from "../src/one-c-exchange-watch.js";

// Real-database check of the late-exchange query. Skipped unless
// ONE_C_WATCH_DATABASE_URL points at a migrated scratch database: the test
// rewrites the exchange times of the second 1С base and puts them back.
const connectionString = process.env.ONE_C_WATCH_DATABASE_URL;
const database = connectionString ? new Pool({ connectionString, max: 2, statement_timeout: 5_000 }) : null;
const logger = { warn: () => undefined };

describe.skipIf(!database)("late 1С exchange alerts (real PostgreSQL)", () => {
  const KEY = "one_c_secondary";
  let before: { expected_sync_minutes: number; is_enabled: boolean; last_offers_exchange_at: Date | null } | undefined;

  const set = (enabled: boolean, lastOffers: string | null, minutes = 1440) => database!.query(
    `UPDATE app.integration_endpoints
     SET is_enabled = $2, expected_sync_minutes = $4,
         last_offers_exchange_at = CASE WHEN $3::text IS NULL THEN NULL ELSE clock_timestamp() - $3::interval END
     WHERE integration_key = $1`,
    [KEY, enabled, lastOffers, minutes],
  );
  const alerts = async () => (await database!.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM app.outbox_events WHERE topic = $1 AND payload->>'sourceKey' = $2 ORDER BY created_at`,
    [ONE_C_EXCHANGE_LATE_TOPIC, KEY],
  )).rows;
  const clean = () => database!.query("DELETE FROM app.outbox_events WHERE topic = $1", [ONE_C_EXCHANGE_LATE_TOPIC]);

  beforeAll(async () => {
    before = (await database!.query<NonNullable<typeof before>>(
      "SELECT is_enabled, expected_sync_minutes, last_offers_exchange_at FROM app.integration_endpoints WHERE integration_key = $1",
      [KEY],
    )).rows[0];
    await database!.query("UPDATE app.integration_endpoints SET is_enabled = false WHERE integration_key = 'one_c'");
    await clean();
  });

  afterAll(async () => {
    if (database && before) {
      await clean();
      await database.query(
        "UPDATE app.integration_endpoints SET is_enabled = $2, expected_sync_minutes = $3, last_offers_exchange_at = $4 WHERE integration_key = $1",
        [KEY, before.is_enabled, before.expected_sync_minutes, before.last_offers_exchange_at],
      );
    }
    await database?.end();
  });

  it("the daily default is in place", async () => {
    const column = await database!.query<{ column_default: string }>(
      `SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'app' AND table_name = 'integration_endpoints' AND column_name = 'expected_sync_minutes'`,
    );
    expect(column.rows[0]?.column_default).toBe("1440");
  });

  it("is silent for a base that is on time, switched off or has never exchanged", async () => {
    await set(true, "47 hours");
    expect(await queueLateExchangeAlerts(database!, logger as never)).toEqual([]);
    await set(false, "5 days");
    expect(await queueLateExchangeAlerts(database!, logger as never)).toEqual([]);
    await set(true, null);
    expect(await queueLateExchangeAlerts(database!, logger as never)).toEqual([]);
    expect(await alerts()).toHaveLength(0);
  });

  it("alerts once when a daily exchange has not come for two days, and again only a day later", async () => {
    await set(true, "49 hours");
    expect(await queueLateExchangeAlerts(database!, logger as never)).toEqual([KEY]);
    expect(await queueLateExchangeAlerts(database!, logger as never)).toEqual([]);
    const [alert] = await alerts();
    expect(alert?.payload).toMatchObject({ expectedSyncMinutes: 1440, sourceKey: KEY });
    expect(String(alert?.payload.lastOffersExchangeAt)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u);

    await database!.query("UPDATE app.outbox_events SET created_at = created_at - interval '25 hours' WHERE topic = $1", [ONE_C_EXCHANGE_LATE_TOPIC]);
    expect(await queueLateExchangeAlerts(database!, logger as never)).toEqual([KEY]);
    expect(await alerts()).toHaveLength(2);
  });

  it("alerts again about a base that recovered and fell silent once more", async () => {
    await clean();
    await set(true, "3 hours", 60);
    expect(await queueLateExchangeAlerts(database!, logger as never)).toEqual([KEY]);
    // An exchange arrives, then the base is late again within the same day.
    await database!.query("UPDATE app.outbox_events SET created_at = created_at - interval '4 hours' WHERE topic = $1", [ONE_C_EXCHANGE_LATE_TOPIC]);
    expect(await queueLateExchangeAlerts(database!, logger as never)).toEqual([KEY]);
    expect(await alerts()).toHaveLength(2);
  });
});
