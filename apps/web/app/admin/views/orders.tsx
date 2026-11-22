"use client";

import { useEffect, useRef, useState } from "react";
import { Badge, Button, Input, MessageBar, MessageBarBody, Select, Spinner } from "@fluentui/react-components";
import { ArrowClockwise20Regular, Dismiss20Regular, Open20Regular, Play20Regular, Search20Regular } from "@fluentui/react-icons";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

import type { OrderStatus } from "@an30/contracts";

import { api, queryString } from "../api";
import { DataTable } from "../data-table";
import type { OrderDetail, OrderRow, Page } from "../types";
import {
  formatDate,
  formatMoney,
  ORDER_LABELS,
  Pagination,
  RequestError,
  SectionHeader,
  useResource,
} from "../workspace-utils";
import styles from "../workspace.module.css";

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  awaiting_confirmation: "processing",
  awaiting_delivery_terms: "processing",
  processing: "ready",
  ready: "completed",
};

export function OrdersView() {
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("createdAt");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState(new Set<string>());
  const [mutationError, setMutationError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<unknown>(null);
  const [cancelOrder, setCancelOrder] = useState<OrderRow | null>(null);
  const detailRequest = useRef(0);
  const limit = 25;

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("status");
    if (requested && Object.hasOwn(ORDER_LABELS, requested)) setStatus(requested);
  }, []);

  useEffect(() => {
    setSelected(new Set());
  }, [appliedSearch, direction, offset, sort, status]);

  const resource = useResource(
    () => api<Page<OrderRow>>(`/staff/orders${queryString({
      direction,
      limit,
      offset,
      q: appliedSearch || undefined,
      sort,
      status: status || undefined,
    })}`),
    [offset, appliedSearch, status, sort, direction],
  );

  async function advance(row: OrderRow): Promise<void> {
    const next = NEXT_STATUS[row.status];
    if (!next) return;
    setBusy(true);
    setMutationError(null);
    try {
      await api(`/orders/${row.id}/status`, {
        body: JSON.stringify({ reason: "Изменено в рабочем месте персонала", status: next, version: row.version }),
        method: "PATCH",
      });
      setSelected((current) => {
        const nextSelected = new Set(current);
        nextSelected.delete(row.id);
        return nextSelected;
      });
      resource.reload();
      if (detail?.id === row.id) void openOrder(row.id);
    } catch (error) {
      setMutationError(error);
    } finally {
      setBusy(false);
    }
  }

  async function openOrder(orderId: string): Promise<void> {
    const requestId = detailRequest.current + 1;
    detailRequest.current = requestId;
    setDetailId(orderId);
    setDetail(null);
    setDetailLoading(true);
    setDetailError(null);
    try {
      const loaded = await api<OrderDetail>(`/orders/${orderId}`);
      if (detailRequest.current === requestId) setDetail(loaded);
    } catch (error) {
      if (detailRequest.current === requestId) setDetailError(error);
    } finally {
      if (detailRequest.current === requestId) setDetailLoading(false);
    }
  }

  async function confirmCancellation(): Promise<void> {
    if (!cancelOrder) return;
    setBusy(true);
    setMutationError(null);
    try {
      await api(`/orders/${cancelOrder.id}/status`, {
        body: JSON.stringify({ reason: "Заявка отменена сотрудником", status: "cancelled", version: cancelOrder.version }),
        method: "PATCH",
      });
      setCancelOrder(null);
      resource.reload();
      if (detail?.id === cancelOrder.id) void openOrder(cancelOrder.id);
    } catch (error) {
      setMutationError(error);
    } finally {
      setBusy(false);
    }
  }

  async function advanceSelected(): Promise<void> {
    const rows = (resource.data?.items ?? []).filter((row) => selected.has(row.id) && NEXT_STATUS[row.status]);
    if (rows.length === 0) return;
    setBusy(true);
    setMutationError(null);
    const results = await Promise.allSettled(rows.map((row) => api(`/orders/${row.id}/status`, {
      body: JSON.stringify({
        reason: "Массовое действие в рабочем месте персонала",
        status: NEXT_STATUS[row.status],
        version: row.version,
      }),
      method: "PATCH",
    })));
    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length > 0) setMutationError(new Error(`Не обновлено заказов: ${failed.length}. Обновите очередь.`));
    setSelected(new Set());
    setBusy(false);
    resource.reload();
  }

  const columns: Array<ColumnDef<OrderRow>> = [
    {
      accessorKey: "publicNumber",
      cell: ({ row }) => <strong>{row.original.publicNumber}</strong>,
      header: "Заказ",
    },
    {
      accessorKey: "createdAt",
      cell: ({ row }) => formatDate(row.original.createdAt),
      header: "Создан",
    },
    {
      id: "customer",
      cell: ({ row }) => (
        <div className={styles.cellStack}>
          <strong>{row.original.customerName}</strong>
          <span>{row.original.customerPhone}</span>
        </div>
      ),
      header: "Клиент",
    },
    {
      accessorKey: "status",
      cell: ({ row }) => (
        <Badge appearance="tint" color={row.original.status === "awaiting_confirmation" ? "warning" : "brand"}>
          {ORDER_LABELS[row.original.status]}
        </Badge>
      ),
      header: "Статус",
    },
    {
      accessorKey: "totalAmountKopeks",
      cell: ({ row }) => <strong>{formatMoney(row.original.totalAmountKopeks)}</strong>,
      header: "Сумма",
    },
    {
      id: "action",
      cell: ({ row }) => (
        <div className={styles.rowActions}>
          <Button appearance="subtle" icon={<Open20Regular />} onClick={() => void openOrder(row.original.id)} size="small">Открыть</Button>
          {NEXT_STATUS[row.original.status] ? (
            <Button
              appearance="subtle"
              disabled={busy}
              onClick={() => void advance(row.original)}
              size="small"
            >
              {row.original.status === "awaiting_confirmation" ? "Подтвердить"
                : NEXT_STATUS[row.original.status] === "processing" ? "В работу"
                : NEXT_STATUS[row.original.status] === "ready" ? "Готов" : "Завершить"}
            </Button>
          ) : null}
          {row.original.status === "awaiting_confirmation" ? (
            <Button appearance="subtle" onClick={() => setCancelOrder(row.original)} size="small">Отменить</Button>
          ) : null}
          {!(["awaiting_confirmation", "cancelled"].includes(row.original.status)) ? (
            <Link className={styles.inlineLink} href={`/admin/invoices?orderId=${row.original.id}`}>Накладная</Link>
          ) : null}
          {!NEXT_STATUS[row.original.status] && row.original.status === "cancelled"
            ? <span className={styles.muted}>Нет действий</span> : null}
        </div>
      ),
      header: "Действие",
    },
  ];

  return (
    <>
      <SectionHeader
        actions={<Button icon={<ArrowClockwise20Regular />} onClick={resource.reload}>Обновить</Button>}
        description="Цена и состав заказа сохраняются в момент оформления и дальше не меняются. Если заказ одновременно правит другой сотрудник, сайт предупредит об этом."
        eyebrow="Продажи"
        title="Заказы"
      />
      <div className={styles.toolbar}>
        <Input
          aria-label="Поиск заказов"
          contentBefore={<Search20Regular />}
          onChange={(_event, data) => setSearch(data.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && search.trim().length !== 1) { setOffset(0); setAppliedSearch(search.trim()); }
          }}
          placeholder="Номер, имя, email или телефон"
          value={search}
        />
        <Button disabled={search.trim().length === 1} onClick={() => { setOffset(0); setAppliedSearch(search.trim()); }}>Найти</Button>
        <Select aria-label="Статус заказа" onChange={(event) => { setOffset(0); setStatus(event.target.value); }} value={status}>
          <option value="">Все статусы</option>
          {Object.entries(ORDER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        {search.trim().length === 1 ? <span className={styles.unsavedState}>Введите минимум 2 символа</span>
          : search.trim() !== appliedSearch ? <span className={styles.unsavedState}>Фильтр не применён</span> : null}
        {selected.size > 0 ? (
          <Button disabled={busy} icon={<Play20Regular />} onClick={() => void advanceSelected()}>
            Следующий этап ({selected.size})
          </Button>
        ) : null}
      </div>
      {resource.error ? <RequestError error={resource.error} onRetry={resource.reload} /> : null}
      {mutationError ? <RequestError error={mutationError} onRetry={resource.reload} /> : null}
      {cancelOrder ? (
        <MessageBar intent="warning" className={styles.confirmBar}>
          <MessageBarBody>Отменить заявку {cancelOrder.publicNumber}?</MessageBarBody>
          <Button disabled={busy} onClick={() => void confirmCancellation()}>Подтвердить отмену</Button>
          <Button disabled={busy} icon={<Dismiss20Regular />} onClick={() => setCancelOrder(null)}>Оставить заказ</Button>
        </MessageBar>
      ) : null}
      <DataTable
        columns={columns}
        data={resource.data?.items ?? []}
        direction={direction}
        emptyDescription="Заказы появятся здесь, как только покупатели оформят их на сайте."
        emptyTitle="Заявок пока нет"
        loading={resource.loading}
        onSelectionChange={setSelected}
        onSort={(nextSort, nextDirection) => { setOffset(0); setSort(nextSort); setDirection(nextDirection); }}
        selected={selected}
        sort={sort}
        sortable={["createdAt", "publicNumber", "status", "totalAmountKopeks"]}
      />
      {resource.data ? (
        <Pagination limit={limit} offset={offset} onChange={setOffset} total={resource.data.total} />
      ) : null}
      {detailLoading ? <div className={styles.orderDetail}><Spinner label="Загрузка заказа" /></div> : null}
      {detailError && detailId ? <RequestError error={detailError} onRetry={() => void openOrder(detailId)} /> : null}
      {detail ? (
        <section className={styles.orderDetail} aria-labelledby="order-detail-title">
          <div className={styles.previewHeader}>
            <div>
              <span className={styles.eyebrow}>Заказ {detail.publicNumber}</span>
              <h2 id="order-detail-title">Состав и расчёты</h2>
              <p>{detail.contact.name}, {detail.contact.phone}, {detail.contact.email}</p>
            </div>
            <Button onClick={() => { setDetail(null); setDetailId(null); setDetailError(null); }}>Закрыть</Button>
          </div>
          <div className={styles.orderDetailGrid}>
            <section>
              <h3>Товары</h3>
              <dl className={styles.detailList}>
                {detail.items.map((item) => (
                  <div key={item.id}>
                    <dt><strong>{item.name}</strong><span>{item.sku} · {item.quantity} × {formatMoney(item.unitPriceKopeks)}</span></dt>
                    <dd>{formatMoney(item.lineTotalKopeks)}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section>
              <h3>Доставка и итог</h3>
              <dl className={styles.detailList}>
                <div><dt>Способ</dt><dd>{detail.delivery.method === "pickup" ? "Самовывоз" : "Согласовать доставку"}</dd></div>
                {detail.delivery.address ? <div><dt>Адрес</dt><dd>{detail.delivery.address}</dd></div> : null}
                <div><dt>Товары</dt><dd>{formatMoney(detail.subtotalKopeks)}</dd></div>
                <div><dt>Итого</dt><dd><strong>{formatMoney(detail.totalAmountKopeks)}</strong></dd></div>
              </dl>
              {detail.customerNote ? <p className={styles.customerNote}><strong>Комментарий клиента:</strong> {detail.customerNote}</p> : null}
            </section>
          </div>
        </section>
      ) : null}
    </>
  );
}
