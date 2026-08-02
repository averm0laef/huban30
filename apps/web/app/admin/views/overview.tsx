"use client";

import { Badge, Button, Card, Spinner } from "@fluentui/react-components";
import { ArrowClockwise20Regular } from "@fluentui/react-icons";
import Link from "next/link";

import { api } from "../api";
import type { SessionView } from "../types";
import { formatMoney, RequestError, SectionHeader, useResource } from "../workspace-utils";
import styles from "../workspace.module.css";

interface Summary {
  catalog: { lowStock: number; outOfStock: number };
  chats: { unassigned: number; waitingStaff: number };
  generatedAt: string;
  orders: { active: number; ready: number; waitingPayment: number };
  cashflowTodayKopeks: number | null;
}

export function OverviewView({ session }: { session: SessionView }) {
  const resource = useResource(() => api<Summary>("/staff/summary"), []);
  return (
    <>
      <SectionHeader
        actions={<Button icon={<ArrowClockwise20Regular />} onClick={resource.reload}>Обновить</Button>}
        description="Только реальные очереди из автономной базы. Значения обновляются по запросу."
        eyebrow="Оперативная сводка"
        title="Рабочая очередь"
      />
      {resource.error ? <RequestError error={resource.error} onRetry={resource.reload} /> : null}
      {resource.loading && !resource.data ? (
        <div className={styles.loadingPanel}><Spinner label="Загрузка сводки" /></div>
      ) : resource.data ? (
        <div className={styles.metricGrid}>
          <QueueCard href="/admin/orders" label="Активные заказы" value={resource.data.orders.active} />
          <QueueCard href="/admin/chats" label="Ждут сотрудника" value={resource.data.chats.waitingStaff} attention />
          <QueueCard href="/admin/chats?assigned=unassigned" label="Без ответственного" value={resource.data.chats.unassigned} attention />
          <QueueCard href="/admin/orders?status=ready" label="Готовы к выдаче" value={resource.data.orders.ready} />
          <QueueCard href="/admin/catalog?availability=out_of_stock" label="Нет в наличии" value={resource.data.catalog.outOfStock} />
          <QueueCard href="/admin/catalog?availability=low_stock" label="Малый остаток" value={resource.data.catalog.lowStock} attention />
          {resource.data.cashflowTodayKopeks !== null ? (
            <QueueCard href="/admin/reports" label="Денежный поток сегодня" value={formatMoney(resource.data.cashflowTodayKopeks)} wide />
          ) : null}
        </div>
      ) : null}
      <Card className={styles.contextCard}>
        <div>
          <strong>Сеанс: {session.email}</strong>
          <span>Роль и каждое действие проверяются сервером. Доступные разделы уже отфильтрованы.</span>
        </div>
        <Badge appearance="tint" color="success">MFA подтверждена</Badge>
      </Card>
    </>
  );
}

function QueueCard({
  attention = false,
  href,
  label,
  value,
  wide = false,
}: {
  attention?: boolean;
  href: string;
  label: string;
  value: number | string;
  wide?: boolean;
}) {
  return (
    <Link className={`${styles.metricCard} ${wide ? styles.metricWide : ""}`} href={href}>
      <span>{label}</span>
      <strong>{value}</strong>
      {attention ? <Badge appearance="filled" color="warning">Требует внимания</Badge> : <small>Открыть очередь</small>}
    </Link>
  );
}
