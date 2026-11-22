"use client";

import { Button, Spinner } from "@fluentui/react-components";
import { ArrowClockwise20Regular } from "@fluentui/react-icons";

import type { OrderStatus } from "@an30/contracts";

import { api } from "../api";
import { ORDER_LABELS, RequestError, SectionHeader, useResource } from "../workspace-utils";
import styles from "../workspace.module.css";

interface ReportData {
  days: Array<{ date: string; orders: number }>;
  generatedAt: string;
  orderStatuses: Array<{ count: number; status: OrderStatus }>;
}

export function ReportsView() {
  const resource = useResource(() => api<ReportData>("/staff/reports"), []);
  const max = Math.max(1, ...(resource.data?.days.map((day) => day.orders) ?? [1]));
  return (
    <>
      <SectionHeader
        actions={<Button icon={<ArrowClockwise20Regular />} onClick={resource.reload}>Обновить</Button>}
        description="Заявки по дате создания и заказы по статусам за последние 14 дней по времени Читы."
        eyebrow="Аналитика"
        title="Отчёты"
      />
      {resource.error ? <RequestError error={resource.error} onRetry={resource.reload} /> : null}
      {resource.loading ? <div className={styles.loadingPanel}><Spinner label="Расчёт отчёта" /></div> : null}
      {resource.data ? (
        <div className={styles.reportGrid}>
          <section className={styles.reportPanel} aria-labelledby="revenue-title">
            <h2 id="revenue-title">Заявки по дням</h2>
            <div className={styles.barChart}>
              {resource.data.days.map((day) => (
                <div className={styles.barRow} key={day.date}>
                  <time>{new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short" }).format(new Date(`${day.date}T00:00:00`))}</time>
                  <span className={styles.barTrack}><span style={{ width: `${Math.max(2, (day.orders / max) * 100)}%` }} /></span>
                  <strong>{day.orders}</strong>
                </div>
              ))}
            </div>
          </section>
          <section className={styles.reportPanel} aria-labelledby="statuses-title">
            <h2 id="statuses-title">Заказы по статусам</h2>
            <dl className={styles.statusList}>
              {resource.data.orderStatuses.length === 0 ? <div><dt>Нет заказов</dt><dd>0</dd></div> : null}
              {resource.data.orderStatuses.map((entry) => (
                <div key={entry.status}><dt>{ORDER_LABELS[entry.status]}</dt><dd>{entry.count}</dd></div>
              ))}
            </dl>
          </section>
        </div>
      ) : null}
    </>
  );
}
