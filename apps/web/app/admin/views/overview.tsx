"use client";

import { Button, Spinner } from "@fluentui/react-components";
import { ArrowClockwise20Regular } from "@fluentui/react-icons";
import Link from "next/link";
import { useState } from "react";

import { api } from "../api";
import { canOpenSection, navigationItem, serviceSection } from "../navigation";
import type { SessionView } from "../types";
import { RequestError, SectionHeader, useResource } from "../workspace-utils";
import styles from "../workspace.module.css";
import board from "./dashboard.module.css";

/** Design board «Админка: сводка» (like PARTS SOFT): numbers, search, services, events, stock. */

type Range = "today" | "7d" | "30d";
type ServiceState = "ok" | "warn" | "error" | "off";

interface Summary {
  catalog: { lowStock: number; outOfStock: number };
  chats: { unassigned: number; waitingStaff: number };
  orders: { active: number; awaitingConfirmation: number; ready: number };
}

interface Dashboard {
  events: { at: string; kind: "chat" | "exchange" | "order" | "request"; text: string }[];
  generatedAt: string;
  kpis: {
    chatsOldestWaitMinutes: number | null;
    chatsWaiting: number;
    orders: { change: number; value: number };
    revenue: { change: number | null; label: string };
    searches: { change: number | null; value: number };
    zeroShare: { change: number | null; value: number | null };
  };
  searchSeries: { buckets: { average: number; label: string; value: number }[]; currentIndex: number; unit: "day" | "hour" };
  services: { detail: string; hint: string | null; key: string; name: string; state: ServiceState }[];
  stock: { lastSyncAt: string | null; lowStock: number; outOfStock: number; total: number };
  zeroResults: { lastAt: string; query: string; times: number }[];
}

const RANGES: { label: string; value: Range }[] = [
  { label: "Сегодня", value: "today" },
  { label: "7 дней", value: "7d" },
  { label: "30 дней", value: "30d" },
];
const PREVIOUS: Record<Range, string> = { "30d": "к прошлым 30 дням", "7d": "к прошлой неделе", today: "к вчера" };
const STATE_LABEL: Record<ServiceState, { icon: string; text: string }> = {
  error: { icon: "✕", text: "Ошибка" },
  off: { icon: "–", text: "Не подключён" },
  ok: { icon: "✓", text: "Работает" },
  warn: { icon: "!", text: "Внимание" },
};
const EVENT_LABEL: Record<Dashboard["events"][number]["kind"], string> = { chat: "Чат", exchange: "1С", order: "Заказ", request: "Заявка" };
const number = new Intl.NumberFormat("ru-RU");

function time(value: string, withDate = false): string {
  return new Intl.DateTimeFormat("ru-RU", withDate
    ? { day: "2-digit", hour: "2-digit", minute: "2-digit", month: "2-digit", timeZone: "Asia/Chita" }
    : { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Chita" }).format(new Date(value));
}

function waitLabel(minutes: number): string {
  if (minutes < 120) return `${minutes} мин`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} ч`;
  return `${Math.round(hours / 24)} дн.`;
}

function Change({ value, suffix, goodWhenUp = true, unit = " %" }: { goodWhenUp?: boolean; suffix: string; unit?: string; value: number | null }) {
  if (value === null) return <small>нет данных для сравнения</small>;
  if (value === 0) return <small>без изменений {suffix}</small>;
  const good = value > 0 === goodWhenUp;
  return (
    <small className={good ? board.up : board.down}>
      {value > 0 ? "▲" : "▼"} {number.format(Math.abs(value))}{unit} <span style={{ color: "#8b8fa8" }}>{suffix}</span>
    </small>
  );
}

function SearchChart({ series }: { series: Dashboard["searchSeries"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const buckets = series.buckets;
  const max = Math.max(4, ...buckets.map((bucket) => Math.max(bucket.value, bucket.average)));
  const step = Math.ceil(max / 3);
  const top = step * 3;
  const width = 760;
  const height = 190;
  const slot = width / Math.max(buckets.length, 1);
  const y = (value: number) => height - (value / top) * height;
  const peak = buckets.reduce((best, bucket, index) => (bucket.value > (buckets[best]?.value ?? -1) ? index : best), 0);
  const average = buckets.map((bucket, index) => `${(index * slot + slot / 2).toFixed(1)},${y(bucket.average).toFixed(1)}`).join(" ");
  const labelEvery = buckets.length > 12 ? Math.ceil(buckets.length / 8) : 1;
  const hovered = hover === null ? null : buckets[hover];
  const total = buckets.reduce((sum, bucket) => sum + bucket.value, 0);
  return (
    <section className={board.card}>
      <header className={board.cardHead}>
        <h2>{series.unit === "hour" ? "Интенсивность поиска по часам" : "Интенсивность поиска по дням"}</h2>
        <span>{total > 0 ? `пик — ${buckets[peak]?.label}${series.unit === "hour" ? ":00" : ""}, ${buckets[peak]?.value} поисков` : "поисков пока не было"}</span>
      </header>
      {asTable ? (
        <div className={board.tableScroll}>
          <table className={board.dataTable}>
            <thead><tr><th>{series.unit === "hour" ? "Час" : "День"}</th><th>Поиски</th><th>Среднее</th></tr></thead>
            <tbody>{buckets.map((bucket) => <tr key={bucket.label}><td>{bucket.label}</td><td>{bucket.value}</td><td>{bucket.average}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className={board.chart} onMouseLeave={() => setHover(null)}>
          <svg aria-label={`Поиски: всего ${total}, пик ${buckets[peak]?.value ?? 0}`} role="img" viewBox={`-34 -12 ${width + 44} ${height + 32}`}>
            {[0, 1, 2, 3].map((line) => (
              <g key={line}>
                <line stroke="#eef0f5" x1={0} x2={width} y1={y(line * step)} y2={y(line * step)} />
                <text fill="#8b8fa8" fontSize={11} textAnchor="end" x={-8} y={y(line * step) + 4}>{line * step}</text>
              </g>
            ))}
            {buckets.map((bucket, index) => {
              const future = series.unit === "hour" && index > series.currentIndex;
              const barHeight = future ? 2 : Math.max((bucket.value / top) * height, bucket.value > 0 ? 2 : 0.5);
              return (
                <g key={bucket.label}>
                  <rect className={future ? board.future : board.bar} data-dim={hover !== null && hover !== index} height={barHeight} rx={3} width={Math.max(slot - 8, 2)} x={index * slot + 4} y={height - barHeight} />
                  {/* Hit target taller and wider than the bar. */}
                  <rect fill="transparent" height={height} onMouseEnter={() => setHover(index)} width={slot} x={index * slot} y={0} />
                  {index % labelEvery === 0 ? <text fill="#8b8fa8" fontSize={11} textAnchor="middle" x={index * slot + slot / 2} y={height + 16}>{bucket.label}</text> : null}
                </g>
              );
            })}
            <polyline className={board.average} points={average} />
          </svg>
          {hovered && hover !== null ? (
            <div className={board.tooltip} style={{ left: `${((hover * slot + slot / 2 + 34) / (width + 44)) * 100}%`, top: `${((y(Math.max(hovered.value, hovered.average)) + 12) / (height + 32)) * 100}%` }}>
              {hovered.label}{series.unit === "hour" ? ":00" : ""} · <strong>{hovered.value}</strong> поисков · среднее {hovered.average}
            </div>
          ) : null}
        </div>
      )}
      <p className={board.note}>
        Столбики — поиски, пунктир — среднее {series.unit === "hour" ? "за 7 дней" : "за прошлый период"}.{" "}
        <button className={board.linkButton} onClick={() => setAsTable((value) => !value)} type="button">{asTable ? "Показать графиком" : "Показать таблицей"}</button>
      </p>
    </section>
  );
}

export function OverviewView({ session }: { session: SessionView }) {
  const [range, setRange] = useState<Range>("today");
  const summary = useResource(() => api<Summary>("/staff/summary"), []);
  const resource = useResource(() => api<Dashboard>(`/staff/dashboard?range=${range}`), [range]);
  const reload = () => { summary.reload(); resource.reload(); };
  const data = resource.data;
  const queue = summary.data;
  const attention = queue ? [
    { count: queue.orders.awaitingConfirmation, href: "/admin/orders?status=awaiting_confirmation", label: "Новые заявки на заказ" },
    { count: queue.chats.unassigned, href: "/admin/chats?assigned=unassigned", label: "Чаты без ответственного" },
    { count: queue.orders.ready, href: "/admin/orders?status=ready", label: "Готовы к выдаче" },
  ].filter((item) => item.count > 0) : [];
  const problems = data ? data.services.filter((service) => service.state === "error").length : 0;
  const warnings = data ? data.services.filter((service) => service.state === "warn").length : 0;
  // A card is a link only when the role can open what it leads to: a manager has no reports and no audit,
  // and a click that ends on «Недостаточно прав» is worse than a card that is plainly not a link.
  const reportsOpen = canOpenSection(session.role, "reports");
  const auditOpen = canOpenSection(session.role, "audit");
  return (
    <>
      <SectionHeader
        actions={(
          <div className={board.toolbar}>
            {RANGES.map((item) => (
              <Button aria-pressed={range === item.value} className={board.rangeButton} key={item.value} onClick={() => setRange(item.value)}>{item.label}</Button>
            ))}
            <Button icon={<ArrowClockwise20Regular />} onClick={reload}>Обновить</Button>
          </div>
        )}
        description={`Вы вошли как ${session.email}. Карточки с цифрами ведут в свой раздел.`}
        eyebrow="Сводка"
        title="Как идут дела"
      />
      {attention.length ? (
        <nav aria-label="Требует внимания" className={board.attention}>
          {attention.map((item) => <Link href={item.href} key={item.href}>{item.label} <strong>{item.count}</strong></Link>)}
        </nav>
      ) : null}
      {resource.error ? <RequestError error={resource.error} onRetry={resource.reload} /> : null}
      {resource.loading && !data ? <div className={styles.loadingPanel}><Spinner label="Загрузка сводки" /></div> : null}
      {data ? (
        <>
          <div className={board.kpis}>
            <Link className={board.kpi} href="/admin/orders"><span>Заказы</span><strong>{number.format(data.kpis.orders.value)}</strong><Change suffix={PREVIOUS[range]} unit="" value={data.kpis.orders.change} /></Link>
            {reportsOpen
              ? <Link className={board.kpi} href="/admin/reports"><span>Выручка</span><strong>{data.kpis.revenue.label}</strong><Change suffix={PREVIOUS[range]} value={data.kpis.revenue.change} /></Link>
              : <div className={board.kpi}><span>Выручка</span><strong>{data.kpis.revenue.label}</strong><Change suffix={PREVIOUS[range]} value={data.kpis.revenue.change} /></div>}
            <div className={board.kpi}><span>Поиски</span><strong>{number.format(data.kpis.searches.value)}</strong><Change suffix={PREVIOUS[range]} value={data.kpis.searches.change} /></div>
            <div className={board.kpi}><span>Поиск без результата</span><strong>{data.kpis.zeroShare.value === null ? "—" : `${String(data.kpis.zeroShare.value).replace(".", ",")} %`}</strong><Change goodWhenUp={false} suffix={PREVIOUS[range]} unit=" п.п." value={data.kpis.zeroShare.change} /></div>
            <Link className={board.kpi} href="/admin/chats"><span>Чаты ждут ответа</span><strong>{data.kpis.chatsWaiting}</strong><small>{data.kpis.chatsOldestWaitMinutes === null ? "никто не ждёт" : `дольше всех ждут ${waitLabel(data.kpis.chatsOldestWaitMinutes)}`}</small></Link>
          </div>

          <div className={board.row}>
            <SearchChart series={data.searchSeries} />
            <section className={board.card}>
              <header className={board.cardHead}><h2>Ищут, но не находят</h2></header>
              {data.zeroResults.length ? (
                <ol className={board.list}>
                  {data.zeroResults.map((item) => <li key={item.query}><span>{item.query}</span><span>{item.times}×</span></li>)}
                </ol>
              ) : <p className={board.empty}>Пусто — всё, что искали, нашлось.</p>}
              <p className={board.note}>Кандидаты в ассортимент или синонимы для поиска.</p>
            </section>
          </div>

          <section className={board.card} style={{ marginBottom: 14 }}>
            <header className={board.cardHead}>
              <h2>Мониторинг веб-сервисов</h2>
              <span>проверено {time(data.generatedAt)} · ошибок {problems}, предупреждений {warnings}</span>
            </header>
            <div className={board.servicesScroll}>
              <table className={board.services}>
                <thead><tr><th>Сервис</th><th>Состояние</th><th>Последнее событие</th><th><span className={board.visuallyHidden}>Подсказка</span></th></tr></thead>
                <tbody>
                  {data.services.map((service) => {
                    const section = serviceSection(service.key);
                    const target = section && service.state !== "ok" && canOpenSection(session.role, section) ? navigationItem(section) : null;
                    // The API's own hint may be just the section's name; the link says the same and can be clicked.
                    const hint = target && service.hint === `раздел «${target.label}»` ? null : service.hint;
                    return (
                      <tr key={service.key}>
                        <td>{service.name}</td>
                        <td><span className={board.status} data-state={service.state}><i aria-hidden="true">{STATE_LABEL[service.state].icon}</i>{STATE_LABEL[service.state].text}</span></td>
                        <td>{service.detail}</td>
                        <td>
                          {hint ?? ""}
                          {target ? <>{hint ? " · " : ""}<Link className={board.linkButton} href={target.href}>Открыть «{target.label}»</Link></> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <div className={`${board.row} ${board.rowEven}`}>
            <section className={board.card}>
              <header className={board.cardHead}><h2>Лента событий</h2>{auditOpen ? <Link className={board.linkButton} href="/admin/audit">Весь журнал</Link> : null}</header>
              {data.events.length ? (
                <ul className={`${board.list} ${board.events}`}>
                  {data.events.map((event, index) => (
                    <li key={`${event.at}-${index}`}><time dateTime={event.at}>{time(event.at, range !== "today")}</time><b data-kind={event.kind}>{EVENT_LABEL[event.kind]}</b><span>{event.text}</span></li>
                  ))}
                </ul>
              ) : <p className={board.empty}>Событий пока нет.</p>}
            </section>
            <section className={board.card}>
              <header className={board.cardHead}><h2>Склад</h2></header>
              <div className={board.stock}>
                <Link href="/admin/catalog"><strong>{number.format(data.stock.total)}</strong><span>товаров в каталоге</span></Link>
                <Link href="/admin/catalog?availability=low_stock"><strong>{number.format(data.stock.lowStock)}</strong><span>малый остаток</span></Link>
                <Link href="/admin/catalog?availability=out_of_stock"><strong>{number.format(data.stock.outOfStock)}</strong><span>нет в наличии</span></Link>
              </div>
              <p className={board.note}>Последняя синхронизация с 1С: {data.stock.lastSyncAt ? time(data.stock.lastSyncAt, true) : "ещё не было"}</p>
              <div className={board.links}><Link href="/admin/catalog">Открыть каталог</Link><Link href="/admin/imports">Журнал обменов</Link></div>
            </section>
          </div>
        </>
      ) : null}
    </>
  );
}
