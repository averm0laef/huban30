import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { DatabaseService } from "../infrastructure/database.service.js";
import {
  hubState,
  oneCState,
  parseDashboardRange,
  percentChange,
  quotaState,
  SHOP_TIME_ZONE,
  zeroShare,
  type DashboardRange,
  type ExchangeRunView,
  type ServiceState,
} from "./dashboard-logic.js";

export interface DashboardService {
  detail: string;
  hint: string | null;
  key: string;
  name: string;
  state: ServiceState;
}

export interface DashboardEvent {
  at: string;
  kind: "chat" | "exchange" | "order" | "request";
  text: string;
}

const SPAN: Record<DashboardRange, string> = { "30d": "30 days", "7d": "7 days", today: "1 day" };

const PLATFORM_LABEL: Record<string, string> = { max: "MAX-бот", telegram: "Telegram-бот", vk: "ВКонтакте" };

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rub(kopeks: number): string {
  return `${new Intl.NumberFormat("ru-RU").format(Math.round(kopeks / 100))} ₽`;
}

function shopTime(at: Date | string | null): string | null {
  if (!at) return null;
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", hour: "2-digit", minute: "2-digit", month: "2-digit", timeZone: SHOP_TIME_ZONE })
    .format(typeof at === "string" ? new Date(at) : at);
}

/**
 * Staff dashboard (design board «Админка: сводка»): today's numbers against
 * the same window before, searches per hour, searches that found nothing,
 * the state of every outside service, a short event feed and stock.
 * Read-only; every query is bounded by time or a LIMIT.
 */
@Injectable()
export class StaffDashboardService {
  private readonly rosskoEnabled: boolean;
  private readonly smtpConfigured: boolean;

  constructor(
    private readonly database: DatabaseService,
    config: ConfigService,
  ) {
    this.rosskoEnabled = config.get<string>("ROSSKO_ENABLED") === "true";
    this.smtpConfigured = Boolean(config.get<string>("SMTP_HOST") ?? process.env.SMTP_HOST);
  }

  async dashboard(rawRange: unknown) {
    const range = parseDashboardRange(rawRange);
    const span = SPAN[range];
    const bounds = `(SELECT CASE WHEN $1='today'
        THEN date_trunc('day', now() AT TIME ZONE '${SHOP_TIME_ZONE}') AT TIME ZONE '${SHOP_TIME_ZONE}'
        ELSE now() - $2::interval END AS start)`;
    const [kpis, series, zero, services, events, stock] = await Promise.all([
      this.kpis(range, span, bounds),
      this.searchSeries(range, bounds),
      this.zeroResults(bounds, range, span),
      this.services(),
      this.events(),
      this.stock(),
    ]);
    return { events, generatedAt: new Date().toISOString(), kpis, range, searchSeries: series, services, stock, zeroResults: zero };
  }

  private async kpis(range: DashboardRange, span: string, bounds: string) {
    const result = await this.database.query<Record<string, string | null>>(
      `WITH b AS ${bounds}
      SELECT
        (SELECT count(*) FROM app.orders, b WHERE created_at>=b.start AND cancelled_at IS NULL)::text AS orders,
        (SELECT count(*) FROM app.orders, b WHERE created_at>=b.start-$2::interval AND created_at<now()-$2::interval AND cancelled_at IS NULL)::text AS orders_prev,
        (SELECT COALESCE(sum(total_amount_kopeks),0) FROM app.orders, b WHERE created_at>=b.start AND cancelled_at IS NULL)::text AS revenue,
        (SELECT COALESCE(sum(total_amount_kopeks),0) FROM app.orders, b WHERE created_at>=b.start-$2::interval AND created_at<now()-$2::interval AND cancelled_at IS NULL)::text AS revenue_prev,
        (SELECT count(*) FROM app.catalog_search_log, b WHERE created_at>=b.start)::text AS searches,
        (SELECT count(*) FROM app.catalog_search_log, b WHERE created_at>=b.start-$2::interval AND created_at<now()-$2::interval)::text AS searches_prev,
        (SELECT count(*) FROM app.catalog_search_log, b WHERE created_at>=b.start AND result_count=0)::text AS zero,
        (SELECT count(*) FROM app.catalog_search_log, b WHERE created_at>=b.start-$2::interval AND created_at<now()-$2::interval AND result_count=0)::text AS zero_prev,
        (SELECT count(*) FROM app.chat_threads WHERE deleted_at IS NULL AND status='waiting_staff')::text AS chats_waiting,
        (SELECT floor(extract(epoch FROM now()-min(COALESCE(manager_wait_since,updated_at)))/60)
           FROM app.chat_threads WHERE deleted_at IS NULL AND status='waiting_staff')::text AS chats_oldest_minutes`,
      [range, span],
    );
    const row = result.rows[0] ?? {};
    const n = (key: string) => toNumber(row[key]);
    const zeroNow = zeroShare(n("searches"), n("zero"));
    const zeroPrev = zeroShare(n("searches_prev"), n("zero_prev"));
    return {
      chatsOldestWaitMinutes: row.chats_oldest_minutes === null || row.chats_oldest_minutes === undefined ? null : n("chats_oldest_minutes"),
      chatsWaiting: n("chats_waiting"),
      orders: { change: n("orders") - n("orders_prev"), value: n("orders") },
      revenue: { change: percentChange(n("revenue"), n("revenue_prev")), label: rub(n("revenue")), valueKopeks: n("revenue") },
      searches: { change: percentChange(n("searches"), n("searches_prev")), value: n("searches") },
      zeroShare: { change: zeroNow !== null && zeroPrev !== null ? Math.round((zeroNow - zeroPrev) * 10) / 10 : null, value: zeroNow },
    };
  }

  /** Today: 24 shop-time hours against the 7-day hourly average. Longer ranges: per day against the previous period's daily average. */
  private async searchSeries(range: DashboardRange, bounds: string) {
    if (range === "today") {
      const result = await this.database.query<{ bucket: number; today: string; average: string }>(
        `WITH b AS ${bounds}, hours AS (SELECT generate_series(0,23) AS bucket)
        SELECT hours.bucket,
          (SELECT count(*) FROM app.catalog_search_log, b WHERE created_at>=b.start
             AND extract(hour FROM created_at AT TIME ZONE '${SHOP_TIME_ZONE}')=hours.bucket)::text AS today,
          (SELECT round(count(*)::numeric/7,1) FROM app.catalog_search_log, b WHERE created_at>=b.start-interval '7 days' AND created_at<b.start
             AND extract(hour FROM created_at AT TIME ZONE '${SHOP_TIME_ZONE}')=hours.bucket)::text AS average
        FROM hours ORDER BY hours.bucket`,
        [range, SPAN[range]],
      );
      const nowHour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: SHOP_TIME_ZONE }).format(new Date()));
      return {
        buckets: result.rows.map((row) => ({ average: toNumber(row.average), label: String(row.bucket).padStart(2, "0"), value: toNumber(row.today) })),
        currentIndex: nowHour,
        unit: "hour" as const,
      };
    }
    const result = await this.database.query<{ day: string; value: string; average: string }>(
      `WITH b AS ${bounds},
        days AS (SELECT generate_series(date_trunc('day', b.start AT TIME ZONE '${SHOP_TIME_ZONE}'), date_trunc('day', now() AT TIME ZONE '${SHOP_TIME_ZONE}'), interval '1 day')::date AS day FROM b),
        prev AS (SELECT round(count(*)::numeric / GREATEST(extract(day FROM $2::interval),1),1) AS average
          FROM app.catalog_search_log, b WHERE created_at>=b.start-$2::interval AND created_at<b.start)
      SELECT to_char(days.day,'DD.MM') AS day,
        (SELECT count(*) FROM app.catalog_search_log WHERE (created_at AT TIME ZONE '${SHOP_TIME_ZONE}')::date=days.day)::text AS value,
        (SELECT average FROM prev)::text AS average
      FROM days ORDER BY days.day`,
      [range, SPAN[range]],
    );
    return {
      buckets: result.rows.map((row) => ({ average: toNumber(row.average), label: row.day, value: toNumber(row.value) })),
      currentIndex: result.rows.length - 1,
      unit: "day" as const,
    };
  }

  private async zeroResults(bounds: string, range: DashboardRange, span: string) {
    const result = await this.database.query<{ query: string; times: string; last_at: Date }>(
      `WITH b AS ${bounds}
      SELECT query, count(*)::text AS times, max(created_at) AS last_at
      FROM app.catalog_search_log, b
      WHERE created_at>=b.start AND result_count=0
      GROUP BY query ORDER BY count(*) DESC, max(created_at) DESC LIMIT 8`,
      [range, span],
    );
    return result.rows.map((row) => ({ lastAt: row.last_at.toISOString(), query: row.query, times: toNumber(row.times) }));
  }

  private async services(): Promise<DashboardService[]> {
    const now = new Date();
    const [oneC, quotas, fapiToday, hubs, outbox, index] = await Promise.all([
      this.database.query<{ integration_key: string; display_name: string | null; is_enabled: boolean; status: ExchangeRunView["status"] | null; rows_touched: number | null; rows_rejected: number | null; error_message: string | null; finished_at: Date | null }>(
        `SELECT endpoint.integration_key, endpoint.display_name, endpoint.is_enabled,
           run.status, run.rows_touched, run.rows_rejected, run.error_message, run.updated_at AS finished_at
         FROM app.integration_endpoints AS endpoint
         LEFT JOIN LATERAL (
           SELECT status, rows_touched, rows_rejected, error_message, updated_at
           FROM app.one_c_exchange_runs WHERE source_key=endpoint.integration_key
           ORDER BY created_at DESC LIMIT 1
         ) AS run ON true
         WHERE endpoint.integration_key LIKE 'one\\_c%'
         ORDER BY endpoint.integration_key`,
      ),
      this.database.query<{ provider: string; quota_limit: number | null; remaining: number | null; updated_at: Date | null }>(
        "SELECT provider, quota_limit, remaining, updated_at FROM app.parts_finder_provider_quotas ORDER BY provider",
      ).catch(() => ({ rows: [] as { provider: string; quota_limit: number | null; remaining: number | null; updated_at: Date | null }[] })),
      this.database.query<{ used: string }>(
        `SELECT COALESCE(sum(reserved),0)::text AS used FROM app.parts_finder_fapi_daily
         WHERE day=(now() AT TIME ZONE '${SHOP_TIME_ZONE}')::date`,
      ).catch(() => ({ rows: [{ used: "0" }] })),
      this.database.query<{ platform: string; name: string; is_test: boolean; publish_enabled: boolean; inbox_enabled: boolean; diagnostic: unknown; last_checked_at: Date | null; last_event_at: Date | null }>(
        `SELECT connection.platform, connection.name, connection.is_test, connection.publish_enabled, connection.inbox_enabled,
           connection.diagnostic, connection.last_checked_at,
           (SELECT max(received_at) FROM app.hub_events WHERE connection_id=connection.id) AS last_event_at
         FROM app.hub_connections AS connection ORDER BY connection.platform, connection.name`,
      ),
      this.database.query<{ waiting: string; failed: string; last_error: string | null }>(
        `SELECT count(*) FILTER (WHERE status IN ('pending','processing'))::text AS waiting,
           count(*) FILTER (WHERE status='failed')::text AS failed,
           (SELECT last_error FROM app.outbox_events WHERE topic LIKE 'auth.%' AND last_error IS NOT NULL ORDER BY created_at DESC LIMIT 1) AS last_error
         FROM app.outbox_events WHERE topic LIKE 'auth.%'`,
      ),
      this.database.query<{ queued: string; failing: string; oldest: Date | null }>(
        `SELECT count(*)::text AS queued, count(*) FILTER (WHERE last_error IS NOT NULL)::text AS failing, min(enqueued_at) AS oldest
         FROM app.search_index_queue`,
      ),
    ]);
    const list: DashboardService[] = [];
    for (const row of oneC.rows) {
      const run: ExchangeRunView | null = row.status
        ? { error: row.error_message, finishedAt: row.finished_at?.toISOString() ?? null, rejected: row.rows_rejected ?? 0, status: row.status, touched: row.rows_touched ?? 0 }
        : null;
      const state = oneCState(row.is_enabled, run, now);
      const detail = !row.is_enabled ? "Обмен выключен"
        : !run ? "Обменов ещё не было"
        : run.status === "failed" ? `${shopTime(run.finishedAt)} · ошибка: ${run.error ?? "без описания"}`
        : run.status === "running" ? `Идёт обмен · обработано ${run.touched}`
        : `${shopTime(run.finishedAt)} · ${run.touched} строк, отклонено ${run.rejected}`;
      list.push({ detail, hint: run && run.rejected > 0 ? "открыть журнал обменов" : null, key: row.integration_key, name: `Обмен с 1С · ${row.display_name ?? row.integration_key}`, state });
    }
    const quota = (name: string) => quotas.rows.find((row) => row.provider.toLowerCase().startsWith(name));
    const fapi = quota("fapi");
    list.push({
      detail: fapi && fapi.remaining !== null ? `Остаток ${fapi.remaining} запросов · сегодня ${toNumber(fapiToday.rows[0]?.used)}` : "Нет данных о квоте",
      hint: fapi?.updated_at ? `проверено ${shopTime(fapi.updated_at)}` : null,
      key: "fapi",
      name: "FAPI · VIN-декодер",
      state: quotaState(fapi?.remaining ?? null, fapi?.quota_limit ?? null),
    });
    const rossko = quota("rossko");
    list.push({
      detail: this.rosskoEnabled ? (rossko?.remaining !== undefined && rossko?.remaining !== null ? `Остаток ${rossko.remaining} запросов` : "Подключён") : "Ключи не заполнены",
      hint: this.rosskoEnabled ? null : "secrets/rossko_key1.txt и rossko_key2.txt",
      key: "rossko",
      name: "Rossko API",
      state: this.rosskoEnabled ? (rossko ? quotaState(rossko.remaining, rossko.quota_limit) : "ok") : "off",
    });
    for (const hub of hubs.rows) {
      const state = hubState(hub.publish_enabled, hub.inbox_enabled, hub.diagnostic);
      const failed = (hub.diagnostic as { checks?: { name?: string; ok?: boolean; detail?: string }[] } | null)?.checks?.find((check) => check.ok === false);
      list.push({
        detail: state === "off" ? "Выключено" : failed ? `${failed.name ?? "Проверка"}: ${failed.detail ?? "ошибка"}`
          : hub.last_event_at ? `Последнее входящее ${shopTime(hub.last_event_at)}` : "Входящих ещё не было",
        hint: hub.last_checked_at ? `проверено ${shopTime(hub.last_checked_at)}` : "запустите проверку в «Соцсети и боты»",
        key: `hub:${hub.platform}:${hub.name}`,
        name: `${PLATFORM_LABEL[hub.platform] ?? hub.platform} · ${hub.name}${hub.is_test ? " (тест)" : ""}`,
        state,
      });
    }
    for (const platform of ["telegram", "max", "vk"]) {
      if (hubs.rows.some((hub) => hub.platform === platform)) continue;
      list.push({ detail: "Бот или сообщество ещё не добавлены", hint: "раздел «Соцсети и боты»", key: `hub:${platform}`, name: PLATFORM_LABEL[platform] ?? platform, state: "off" });
    }
    const mail = outbox.rows[0];
    const waiting = toNumber(mail?.waiting);
    list.push({
      detail: this.smtpConfigured ? `В очереди ${waiting} · с ошибкой ${toNumber(mail?.failed)}` : `Не настроена · писем ждут отправки: ${waiting}`,
      hint: mail?.last_error && this.smtpConfigured ? mail.last_error.slice(0, 80) : null,
      key: "smtp",
      name: "Почта (SMTP)",
      state: !this.smtpConfigured ? "off" : toNumber(mail?.failed) > 0 ? "error" : waiting > 20 ? "warn" : "ok",
    });
    const queue = index.rows[0];
    const queued = toNumber(queue?.queued);
    list.push({
      detail: `Очередь ${queued}${toNumber(queue?.failing) > 0 ? ` · с ошибкой ${toNumber(queue?.failing)}` : ""}`,
      hint: queue?.oldest ? `старейшая запись ${shopTime(queue.oldest)}` : null,
      key: "search-index",
      name: "Поисковый индекс",
      state: toNumber(queue?.failing) > 0 ? "error" : queued > 500 ? "warn" : "ok",
    });
    return list;
  }

  private async events(): Promise<DashboardEvent[]> {
    const result = await this.database.query<{ at: Date; kind: DashboardEvent["kind"]; text: string }>(
      `(SELECT created_at AS at, 'order' AS kind,
          '№ ' || public_number || ' · ' || to_char(total_amount_kopeks/100.0,'FM999G999G990') || ' ₽' AS text
        FROM app.orders ORDER BY created_at DESC LIMIT 6)
      UNION ALL
      (SELECT created_at, 'chat', 'Ч-' || lpad(public_number::text,6,'0') || ' · ' || COALESCE(subject,'новый вопрос')
        FROM app.chat_threads WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 6)
      UNION ALL
      (SELECT updated_at, 'exchange',
          CASE status WHEN 'failed' THEN 'Обмен с ошибкой · ' || source_key
            WHEN 'running' THEN 'Идёт обмен · ' || source_key
            ELSE 'Обмен завершён · ' || source_key || ' · ' || rows_touched || ' строк' END
        FROM app.one_c_exchange_runs ORDER BY updated_at DESC LIMIT 6)
      UNION ALL
      (SELECT created_at, 'request', 'Заявка с сайта · ' || CASE source
          WHEN 'vin_request' THEN 'подбор по VIN' WHEN 'expert_help' THEN 'помощь специалиста'
          WHEN 'contacts' THEN 'страница контактов' ELSE source END
        FROM app.contact_requests ORDER BY created_at DESC LIMIT 6)
      ORDER BY at DESC LIMIT 12`,
    );
    return result.rows.map((row) => ({ at: row.at.toISOString(), kind: row.kind, text: row.text }));
  }

  private async stock() {
    const result = await this.database.query<{ total: string; low: string; out: string; last_sync: Date | null }>(
      `WITH stock AS (
        SELECT product.id, COALESCE(sum(balance.quantity_available),0) AS available
        FROM app.products AS product
        LEFT JOIN app.available_inventory AS balance ON balance.product_id=product.id
        WHERE product.deleted_at IS NULL AND product.is_active
        GROUP BY product.id)
      SELECT count(*)::text AS total,
        count(*) FILTER (WHERE available BETWEEN 1 AND 3)::text AS low,
        count(*) FILTER (WHERE available=0)::text AS out,
        (SELECT max(last_exchange_at) FROM app.integration_endpoints WHERE integration_key LIKE 'one\\_c%') AS last_sync
      FROM stock`,
    );
    const row = result.rows[0];
    return {
      lastSyncAt: row?.last_sync?.toISOString() ?? null,
      lowStock: toNumber(row?.low),
      outOfStock: toNumber(row?.out),
      total: toNumber(row?.total),
    };
  }
}
