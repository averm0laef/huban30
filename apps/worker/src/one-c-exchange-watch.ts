// Notices a 1С base that stopped sending its exchange. 1С starts every
// exchange itself (the standard «Обмен с сайтом» protocol has no way for the
// site to ask for one), so a schedule switched off in 1С, a computer that is
// down or a changed address leaves the storefront on the prices and stock of
// the last exchange with nobody told. The staff settings already show
// «Обновление задерживается»; this puts the same fact into the staff alert
// channel (Telegram / VK) through the outbox.
//
// Late means what the settings page means: prices and stock older than two
// expected intervals (two days for the daily schedule). One alert per late
// base, repeated once a day until an exchange arrives.

import type { Logger } from "pino";
import type { Pool } from "pg";

export const ONE_C_EXCHANGE_LATE_TOPIC = "one_c.exchange.late.notify";

const LOCK_NAME = "an30-one-c-exchange-watch";

export const QUEUE_LATE_EXCHANGE_ALERTS_SQL = `
  INSERT INTO app.outbox_events (topic, aggregate_type, aggregate_id, payload)
  SELECT $1, 'integration_endpoint', endpoint.id,
         jsonb_build_object(
           'displayName', endpoint.display_name,
           'expectedSyncMinutes', endpoint.expected_sync_minutes,
           'lastOffersExchangeAt', to_char(endpoint.last_offers_exchange_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           'sourceKey', endpoint.integration_key
         )
  FROM app.integration_endpoints AS endpoint
  WHERE endpoint.integration_key IN ('one_c', 'one_c_secondary')
    AND endpoint.is_enabled
    AND endpoint.last_offers_exchange_at < clock_timestamp() - make_interval(mins => endpoint.expected_sync_minutes * 2)
    AND NOT EXISTS (
      SELECT 1 FROM app.outbox_events AS sent
      WHERE sent.aggregate_type = 'integration_endpoint' AND sent.aggregate_id = endpoint.id AND sent.topic = $1
        AND sent.created_at > endpoint.last_offers_exchange_at
        AND sent.created_at > clock_timestamp() - interval '24 hours'
    )
  RETURNING payload->>'sourceKey' AS source_key`;

/** Queues a staff alert for every enabled 1С base whose exchange is late; returns the bases alerted about. */
export async function queueLateExchangeAlerts(database: Pool, logger: Pick<Logger, "warn">): Promise<string[]> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    // Two workers checking at the same moment must not both alert.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [LOCK_NAME]);
    const queued = await client.query<{ source_key: string }>(QUEUE_LATE_EXCHANGE_ALERTS_SQL, [ONE_C_EXCHANGE_LATE_TOPIC]);
    await client.query("COMMIT");
    const sources = queued.rows.map((row) => row.source_key);
    if (sources.length > 0) logger.warn({ sources }, "1C exchange is late; staff alert queued");
    return sources;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
