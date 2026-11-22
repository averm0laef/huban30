"use client";

import { Badge, Button, Spinner } from "@fluentui/react-components";
import { ArrowClockwise20Regular } from "@fluentui/react-icons";
import { useState } from "react";

import { ApiError, api } from "../api";
import { formatDate, RequestError, useResource } from "../workspace-utils";
import styles from "../workspace.module.css";

interface Overview {
  fapi: {
    cacheEntries: number;
    cacheHits: number;
    checkedAt: string | null;
    configured: boolean;
    dailyLimit: number;
    fitmentEnabled: boolean;
    packageRemaining: number | null;
    plan: string | null;
    status: string | null;
    usedToday: number;
  };
  supplier: { enabled: boolean; lastError: { at: string; message: string } | null; lastSuccessAt: string | null };
  vin: { cacheEntries: number; cacheHits: number; vinrokuRemaining: number | null };
}

interface VehicleCatalog {
  makes: number;
  models: number;
  modifications: number;
  running: boolean;
  lastSync: { creditsUsed: number; error: string | null; finishedAt: string; makesLinked: number; modelsRefreshed: number; modificationsRefreshed: number } | null;
}

const number = new Intl.NumberFormat("ru-RU");

/** Make → model → engine catalog for /podbor, filled from FAPI (TecDoc data) on demand. */
function VehicleCatalogBlock({ fapiConfigured }: { fapiConfigured: boolean }) {
  const resource = useResource(() => api<VehicleCatalog>("/staff/parts-finder/vehicles"), []);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const data = resource.data;
  async function start() {
    setPending(true);
    setMessage("");
    try {
      const result = await api<{ started: boolean }>("/staff/parts-finder/vehicles/sync", {
        body: JSON.stringify({ allMakes: true, maxCredits: 1500, modifications: true }), method: "POST",
      });
      setMessage(result.started ? "Синхронизация запущена. Обновите карточку через несколько минут." : "Синхронизация уже идёт или ключ FAPI не задан.");
      resource.reload();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Не удалось запустить синхронизацию.");
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <h3>Справочник автомобилей для подбора</h3>
      {data ? (
        <dl className={styles.detailList}>
          <div><dt>В справочнике</dt><dd>{number.format(data.makes)} марок, {number.format(data.models)} моделей, {number.format(data.modifications)} модификаций с двигателями</dd></div>
          <div><dt>Последняя синхронизация с FAPI</dt><dd>{data.running ? "идёт сейчас" : data.lastSync
            ? `${formatDate(data.lastSync.finishedAt)}: связано с FAPI ${data.lastSync.makesLinked} марок, обновлены модели ${data.lastSync.modelsRefreshed} марок и двигатели ${data.lastSync.modificationsRefreshed} моделей, ${data.lastSync.creditsUsed} кредитов${data.lastSync.error ? ` — ${data.lastSync.error}` : ""}`
            : "не запускалась после перезапуска сервера"}</dd></div>
        </dl>
      ) : null}
      <p className={styles.muted}>Сначала загружаются японские марки, затем европейские. Двигатели поколения, снятого с производства, оплачиваются один раз и больше не запрашиваются. За один запуск тратится не больше 1 500 кредитов.</p>
      <div><Button appearance="primary" disabled={!fapiConfigured || pending || data?.running} onClick={start}>Обновить справочник из FAPI</Button></div>
      {message ? <p role="status">{message}</p> : null}
    </>
  );
}

const FAPI_STATUS: Record<string, string> = {
  allowed: "доступ открыт",
  denied_balance: "запросы остановлены: нет баланса",
  denied_quota: "запросы остановлены: пакет исчерпан",
  denied_unpaid: "запросы остановлены: пакет не оплачен",
  unbilled: "пакет не выставлен",
};

interface Assortment {
  brandMismatch: number;
  crosses: { confirmed: number; possible: number; reviewForOurProducts: number };
  fapiConfigured: boolean;
  lastRun: { brandMismatch: number; creditsUsed: number; crossesStored: number; error: string | null; finishedAt: string; linked: number; noData: number } | null;
  linkable: number;
  linked: number;
  noData: number;
  pending: number;
  products: number;
  running: boolean;
}

interface ReviewPair {
  id: string;
  ours: { name: string; sku: string; slug: string };
  partA: { article: string; brand: string };
  partB: { article: string; brand: string };
  relation: string | null;
  sources: string[];
}

const SOURCE_NAMES: Record<string, string> = { fapi: "каталог FAPI", manual: "вручную", one_c: "1С", rossko: "поставщик" };

interface TecdocStatus {
  cache: { entries: number | null; maxEntries: number; ttlSeconds: number };
  configured: boolean;
  enabled: boolean;
  lastError: { at: string; detail: string } | null;
  lastSuccessAt: string | null;
  paused: boolean;
  usage: {
    daily: { cacheHits: number; errors: number; limit: number; refused: number; used: number };
    history: Array<{ cacheHits: number; day: string; requests: number }>;
    hourly: { limit: number; used: number };
    period: { end: string; limit: number; start: string; used: number };
  };
}

type TecdocProbe = { categories: number; engines: number; makes: number; models: number; ok: true; sample: string | null } | { detail: string; failure: string; ok: false };

const TECDOC_FAILURES: Record<string, string> = {
  disabled: "ключ не задан",
  limited: "сработал наш лимит запросов",
  refused: "сервис отклонил ключ или пакет исчерпан",
  unavailable: "сервис не ответил",
};

/**
 * TecDoc (tecdoc.site): the vehicle and applicability catalogue. Shows what
 * the paid package is spent on; nothing of the catalogue is stored on our side.
 */
function TecdocBlock() {
  const resource = useResource(() => api<TecdocStatus>("/staff/tecdoc/status"), []);
  const [probe, setProbe] = useState<TecdocProbe | null>(null);
  const [pending, setPending] = useState<"probe" | "clear" | null>(null);
  const [message, setMessage] = useState("");
  const data = resource.data;
  async function check() {
    setPending("probe");
    setMessage("");
    try {
      setProbe(await api<TecdocProbe>("/staff/tecdoc/probe", { method: "POST" }));
      resource.reload();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Проверка не выполнена.");
    } finally {
      setPending(null);
    }
  }
  async function clear() {
    setPending("clear");
    setMessage("");
    try {
      const result = await api<{ removed: number }>("/staff/tecdoc/cache/clear", { method: "POST" });
      setMessage(`Кеш очищен: удалено ответов — ${result.removed}.`);
      resource.reload();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Кеш не очищен.");
    } finally {
      setPending(null);
    }
  }
  if (!data) return null;
  const usage = data.usage;
  const answered = usage.daily.used + usage.daily.cacheHits;
  return (
    <>
      <h3>Каталог TecDoc: автомобили и применимость</h3>
      <dl className={styles.detailList}>
        <div><dt>Состояние</dt><dd>{!data.configured ? "ключ не задан — сайт работает на своём справочнике машин"
          : data.paused ? "приостановлен после отказа сервиса; сайт временно работает на своём справочнике"
            : data.enabled ? "подключён" : "выключен в настройках"}</dd></div>
        <div><dt>Сегодня</dt><dd>{number.format(usage.daily.used)} из {number.format(usage.daily.limit)} запросов; из кеша отвечено {number.format(usage.daily.cacheHits)}
          {answered > 0 ? ` (${Math.round((usage.daily.cacheHits / answered) * 100)} %)` : ""}; отказано по лимитам {number.format(usage.daily.refused)}; ошибок {number.format(usage.daily.errors)}</dd></div>
        <div><dt>За этот час</dt><dd>{number.format(usage.hourly.used)} из {number.format(usage.hourly.limit)}</dd></div>
        <div><dt>Пакет</dt><dd>{number.format(usage.period.used)} из {number.format(usage.period.limit)} запросов за период {usage.period.start} — {usage.period.end}</dd></div>
        <div><dt>Кеш показа</dt><dd>{data.cache.entries === null ? "недоступен" : number.format(data.cache.entries)} из {number.format(data.cache.maxEntries)} ответов, хранится {Math.round(data.cache.ttlSeconds / 3600)} ч</dd></div>
        {data.lastError ? <div><dt>Последняя ошибка</dt><dd>{formatDate(data.lastError.at)}: {data.lastError.detail}</dd></div> : null}
        {usage.history.length > 1 ? <div><dt>По дням</dt><dd>{usage.history.map((day) => `${day.day.slice(5)}: ${number.format(day.requests)}`).join(" · ")}</dd></div> : null}
      </dl>
      <p className={styles.muted}>
        Запрос к каталогу делается только когда покупатель сам что-то открыл. Дневной лимит считается сам: остаток пакета делится на оставшиеся дни,
        за час — не больше пятой части дня. Данные каталога в нашу базу не записываются — так требует договор tecdoc.site.
      </p>
      <div>
        <Button appearance="primary" disabled={!data.configured || pending !== null} onClick={check}>Проверить ключ (до 6 запросов)</Button>{" "}
        <Button appearance="subtle" disabled={pending !== null} onClick={clear}>Очистить кеш</Button>
      </div>
      {probe?.ok ? <p role="status">Ключ работает: марок {probe.makes}, моделей у проверочной марки {probe.models}, двигателей {probe.engines}, разделов запчастей {probe.categories}{probe.sample ? ` (${probe.sample})` : ""}.</p> : null}
      {probe && !probe.ok ? <p role="alert">Проверка не прошла: {TECDOC_FAILURES[probe.failure] ?? probe.failure} ({probe.detail}).</p> : null}
      {message ? <p role="status">{message}</p> : null}
    </>
  );
}

/**
 * How a customer's number reaches our shelf: every product of ours is linked
 * to its original numbers and analogs ahead of time; pairs one source alone
 * asserted wait here for one click.
 */
function AssortmentLinksBlock() {
  const resource = useResource(() => api<Assortment>("/staff/parts-finder/assortment"), []);
  const review = useResource(() => api<{ items: ReviewPair[]; total: number }>("/staff/parts-finder/crosses/review?limit=20"), []);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const data = resource.data;
  async function start() {
    setPending(true);
    setMessage("");
    try {
      const result = await api<{ started: boolean }>("/staff/parts-finder/assortment/link", { body: JSON.stringify({ maxCredits: 2000 }), method: "POST" });
      setMessage(result.started ? "Связывание запущено. Обновите карточку через несколько минут." : "Связывание уже идёт или ключ FAPI не задан.");
      resource.reload();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Не удалось запустить связывание.");
    } finally {
      setPending(false);
    }
  }
  async function decide(id: string, decision: "confirm" | "reject") {
    try {
      await api(`/staff/parts-finder/crosses/${id}/decision`, { body: JSON.stringify({ decision }), method: "POST" });
      review.reload();
      resource.reload();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Не удалось сохранить решение.");
    }
  }
  return (
    <>
      <h3>Связь наших товаров с номерами производителей и аналогами</h3>
      {data ? (
        <dl className={styles.detailList}>
          <div><dt>Товаров с артикулом и брендом</dt><dd>{number.format(data.linkable)} из {number.format(data.products)} (масла, химия и инструмент не связываются)</dd></div>
          <div><dt>Связано</dt><dd>{number.format(data.linked)}; ждут очереди — {number.format(data.pending)}; каталог не знает номер — {number.format(data.noData)}; номер есть под другим брендом — {number.format(data.brandMismatch)}</dd></div>
          <div><dt>База кроссов</dt><dd>{number.format(data.crosses.confirmed)} подтверждённых, {number.format(data.crosses.possible)} предположительных</dd></div>
          <div><dt>Последний запуск</dt><dd>{data.running ? "идёт сейчас" : data.lastRun
            ? `${formatDate(data.lastRun.finishedAt)}: связано ${data.lastRun.linked} товаров, сохранено ${data.lastRun.crossesStored} кроссов, ${data.lastRun.creditsUsed} кредитов${data.lastRun.error ? ` — ${data.lastRun.error}` : ""}`
            : "не запускался после перезапуска сервера"}</dd></div>
        </dl>
      ) : null}
      <p className={styles.muted}>
        Один товар — 1 кредит FAPI (2, если номер есть у нескольких брендов), один раз. Сначала связываются товары в наличии.
        После этого покупатель находит наш товар по оригинальному номеру, по номеру другого бренда и при подборе по машине — без запросов к внешним сервисам.
      </p>
      <div><Button appearance="primary" disabled={!data?.fapiConfigured || pending || data?.running || data?.pending === 0} onClick={start}>Связать товары (до 2 000 кредитов)</Button></div>
      {message ? <p role="status">{message}</p> : null}
      {review.data && review.data.total > 0 ? (
        <>
          <h3>Возможные аналоги наших товаров — на проверку ({number.format(review.data.total)})</h3>
          <p className={styles.muted}>Пока пара не подтверждена, покупатель видит её как «возможный аналог» с кнопкой «Проверить применимость». Пару, которую назвали два источника, сайт подтверждает сам.</p>
          <div className={styles.tableScroller} tabIndex={0} aria-label="Возможные аналоги на проверку">
            <table className={styles.dataTable}>
              <thead><tr><th scope="col">Наш товар</th><th scope="col">Пара</th><th scope="col">Источник</th><th scope="col">Решение</th></tr></thead>
              <tbody>
                {review.data.items.map((pair) => (
                  <tr key={pair.id}>
                    <td>{pair.ours.name}<br /><small>{pair.ours.sku}</small></td>
                    <td>{pair.partA.brand} {pair.partA.article} ↔ {pair.partB.brand} {pair.partB.article}</td>
                    <td>{pair.sources.map((source) => SOURCE_NAMES[source] ?? source).join(", ")}</td>
                    <td>
                      <Button onClick={() => { void decide(pair.id, "confirm"); }} size="small">Это аналог</Button>{" "}
                      <Button appearance="subtle" onClick={() => { void decide(pair.id, "reject"); }} size="small">Не подходит</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}

/** Card «Подбор и поставщики»: FAPI credits, our assortment's links, the vehicle catalog, supplier search state, VIN cache. */
export function PartsFinderStatusCard() {
  const resource = useResource(() => api<Overview>("/staff/parts-finder/overview"), []);
  // Roles without catalog access simply do not see the card.
  if (resource.error instanceof ApiError && resource.error.status === 403) return null;
  const data = resource.data;
  const usedShare = data && data.fapi.dailyLimit > 0 ? data.fapi.usedToday / data.fapi.dailyLimit : 0;
  return (
    <section aria-labelledby="parts-finder-status-title" className={styles.settingsForm}>
      <div className={styles.settingsHeading}>
        <div>
          <h2 id="parts-finder-status-title">Подбор и поставщики</h2>
          <p>Расход кредитов FAPI, поиск у поставщика «под заказ» и расшифровка VIN. Ключи задаются в секретах сервера.</p>
        </div>
        <Button disabled={resource.loading} icon={<ArrowClockwise20Regular />} onClick={resource.reload}>Обновить</Button>
      </div>
      {resource.error ? <RequestError error={resource.error} onRetry={resource.reload} /> : null}
      {resource.loading && !data ? <Spinner label="Загрузка состояния подбора" /> : null}
      {data ? (
        <>
          <h3>FAPI — кроссы и подбор по автомобилю</h3>
          {data.fapi.configured ? (
            <Badge appearance="tint" color={usedShare >= 0.9 ? "warning" : "success"}>
              {usedShare >= 0.9 ? "Дневной лимит почти исчерпан" : "Ключ задан"}
            </Badge>
          ) : <Badge appearance="tint" color="informative">Ключ не задан — аналоги FAPI недоступны, остальной подбор работает</Badge>}
          <dl className={styles.detailList}>
            <div><dt>Потрачено сегодня (по Москве)</dt><dd>{number.format(data.fapi.usedToday)} из {number.format(data.fapi.dailyLimit)} кредитов</dd></div>
            <div><dt>Остаток пакета</dt><dd>{data.fapi.packageRemaining === null ? "ещё не запрашивался" : `${number.format(data.fapi.packageRemaining)} кредитов`}</dd></div>
            <div><dt>Тариф</dt><dd>{data.fapi.plan ?? "—"}{data.fapi.status ? `, ${FAPI_STATUS[data.fapi.status] ?? data.fapi.status}` : ""}</dd></div>
            <div><dt>Проверено</dt><dd>{formatDate(data.fapi.checkedAt)}</dd></div>
            <div><dt>Подбор машины через FAPI</dt><dd>{data.fapi.fitmentEnabled ? "включён (до 35 кредитов на новый подбор)" : "выключен — машина подбирается по справочнику магазина"}</dd></div>
            <div><dt>Ответы из общего кеша</dt><dd>{number.format(data.fapi.cacheHits)} повторов без списания, {number.format(data.fapi.cacheEntries)} сохранённых ответов</dd></div>
          </dl>
          <TecdocBlock />
          <AssortmentLinksBlock />
          <VehicleCatalogBlock fapiConfigured={data.fapi.configured} />
          <h3>Поставщик — позиции «под заказ»</h3>
          <Badge appearance="tint" color={!data.supplier.enabled ? "informative" : data.supplier.lastError && (!data.supplier.lastSuccessAt || data.supplier.lastError.at > data.supplier.lastSuccessAt) ? "warning" : "success"}>
            {data.supplier.enabled ? "Подключён" : "Выключен — нет ключей"}
          </Badge>
          <dl className={styles.detailList}>
            <div><dt>Последний успешный ответ</dt><dd>{formatDate(data.supplier.lastSuccessAt)}</dd></div>
            <div><dt>Последняя ошибка</dt><dd>{data.supplier.lastError ? `${formatDate(data.supplier.lastError.at)} — ${data.supplier.lastError.message}` : "не было"}</dd></div>
          </dl>
          <h3>Расшифровка VIN и номеров кузова</h3>
          <dl className={styles.detailList}>
            <div><dt>Сохранено расшифровок</dt><dd>{number.format(data.vin.cacheEntries)}</dd></div>
            <div><dt>Повторов из кеша</dt><dd>{number.format(data.vin.cacheHits)}</dd></div>
            <div><dt>Запросов VINROKU на сегодня</dt><dd>{data.vin.vinrokuRemaining === null ? "лимит не достигнут" : `осталось ${number.format(data.vin.vinrokuRemaining)} из 100`}</dd></div>
          </dl>
        </>
      ) : null}
    </section>
  );
}
