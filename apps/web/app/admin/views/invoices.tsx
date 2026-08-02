"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Input, MessageBar, MessageBarBody, Select } from "@fluentui/react-components";
import { Add20Regular, ArrowClockwise20Regular, Checkmark20Regular, Dismiss20Regular, Search20Regular } from "@fluentui/react-icons";
import type { ColumnDef } from "@tanstack/react-table";

import { api, queryString } from "../api";
import { DataTable } from "../data-table";
import type { InvoiceRow, Page } from "../types";
import { formatDate, formatMoney, INVOICE_LABELS, Pagination, RequestError, SectionHeader, useResource } from "../workspace-utils";
import styles from "../workspace.module.css";

interface PendingInvoiceAction {
  invoice: InvoiceRow;
  status: "cancelled" | "issued";
}

export function InvoicesView() {
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("createdAt");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [orderId, setOrderId] = useState("");
  const [pending, setPending] = useState<PendingInvoiceAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<unknown>(null);
  const limit = 25;

  useEffect(() => {
    setOrderId(new URLSearchParams(window.location.search).get("orderId") ?? "");
  }, []);

  const resource = useResource(
    () => api<Page<InvoiceRow>>(`/staff/invoices${queryString({
      direction,
      limit,
      offset,
      q: appliedSearch || undefined,
      sort,
      status: status || undefined,
    })}`),
    [direction, offset, appliedSearch, sort, status],
  );

  async function createInvoice(): Promise<void> {
    if (!orderId.trim()) return;
    setBusy(true);
    setMutationError(null);
    try {
      await api("/staff/invoices", { body: JSON.stringify({ orderId: orderId.trim() }), method: "POST" });
      setOrderId("");
      resource.reload();
    } catch (error) {
      setMutationError(error);
    } finally {
      setBusy(false);
    }
  }

  async function confirmUpdate(): Promise<void> {
    if (!pending) return;
    setBusy(true);
    setMutationError(null);
    try {
      await api(`/staff/invoices/${pending.invoice.id}`, {
        body: JSON.stringify({
          reason: pending.status === "issued" ? "Накладная выдана клиенту" : "Накладная аннулирована сотрудником",
          status: pending.status,
          version: pending.invoice.version,
        }),
        method: "PATCH",
      });
      setPending(null);
      resource.reload();
    } catch (error) {
      setMutationError(error);
    } finally {
      setBusy(false);
    }
  }

  const columns = useMemo<Array<ColumnDef<InvoiceRow>>>(() => [
    { accessorKey: "invoiceNumber", cell: ({ row }) => <strong>{row.original.invoiceNumber}</strong>, header: "Накладная" },
    {
      id: "order",
      cell: ({ row }) => (
        <div className={styles.cellStack}>
          <strong>{row.original.orderNumber ?? "Без заказа"}</strong>
          <span>{row.original.customerName ?? "Клиент не указан"}</span>
        </div>
      ),
      header: "Заказ",
    },
    { accessorKey: "createdAt", cell: ({ row }) => formatDate(row.original.createdAt), header: "Создана" },
    { accessorKey: "amountKopeks", cell: ({ row }) => formatMoney(row.original.amountKopeks), header: "Сумма" },
    { accessorKey: "status", cell: ({ row }) => <Badge appearance="tint">{INVOICE_LABELS[row.original.status]}</Badge>, header: "Статус" },
    {
      id: "actions",
      cell: ({ row }) => (
        <div className={styles.rowActions}>
          {row.original.status === "draft" ? (
            <Button appearance="subtle" onClick={() => setPending({ invoice: row.original, status: "issued" })} size="small">Выдать</Button>
          ) : null}
          {row.original.status !== "cancelled" ? (
            <Button appearance="subtle" onClick={() => setPending({ invoice: row.original, status: "cancelled" })} size="small">Аннулировать</Button>
          ) : <span className={styles.muted}>Нет действий</span>}
        </div>
      ),
      header: "Действия",
    },
  ], []);

  return (
    <>
      <SectionHeader
        actions={<Button icon={<ArrowClockwise20Regular />} onClick={resource.reload}>Обновить</Button>}
        description="Сумма берётся из заказа на сервере. Номер создаётся атомарно, состояние защищено версией."
        eyebrow="Документы"
        title="Накладные"
      />
      <div className={styles.createStrip}>
        <div>
          <strong>Новая накладная</strong>
          <span>Откройте заказ и передайте его идентификатор. Для одного заказа разрешена одна действующая накладная.</span>
        </div>
        <Input aria-label="Идентификатор заказа" onChange={(_event, data) => setOrderId(data.value)} placeholder="UUID заказа" value={orderId} />
        <Button appearance="primary" disabled={busy || !orderId.trim()} icon={<Add20Regular />} onClick={() => void createInvoice()}>Создать черновик</Button>
        {orderId ? <span className={styles.unsavedState}>Есть несохранённый идентификатор</span> : null}
      </div>
      <div className={styles.toolbar}>
        <Input
          aria-label="Поиск накладных"
          contentBefore={<Search20Regular />}
          onChange={(_event, data) => setSearch(data.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && search.trim().length !== 1) setAppliedSearch(search.trim()); }}
          placeholder="Номер накладной, заказа или клиент"
          value={search}
        />
        <Button disabled={search.trim().length === 1} onClick={() => { setOffset(0); setAppliedSearch(search.trim()); }}>Найти</Button>
        <Select aria-label="Статус накладной" onChange={(event) => { setOffset(0); setStatus(event.target.value); }} value={status}>
          <option value="">Все статусы</option>
          {Object.entries(INVOICE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        {search.trim().length === 1 ? <span className={styles.unsavedState}>Введите минимум 2 символа</span>
          : search.trim() !== appliedSearch ? <span className={styles.unsavedState}>Фильтр не применён</span> : null}
      </div>
      {pending ? (
        <MessageBar intent={pending.status === "cancelled" ? "warning" : "info"} className={styles.confirmBar}>
          <MessageBarBody>
            {pending.status === "issued"
              ? `Отметить накладную ${pending.invoice.invoiceNumber} как выданную?`
              : `Аннулировать накладную ${pending.invoice.invoiceNumber}? История останется в аудите.`}
          </MessageBarBody>
          <Button disabled={busy} icon={<Checkmark20Regular />} onClick={() => void confirmUpdate()}>Подтвердить</Button>
          <Button disabled={busy} icon={<Dismiss20Regular />} onClick={() => setPending(null)}>Отмена</Button>
        </MessageBar>
      ) : null}
      {resource.error ? <RequestError error={resource.error} onRetry={resource.reload} /> : null}
      {mutationError ? <RequestError error={mutationError} onRetry={resource.reload} /> : null}
      <DataTable
        columns={columns}
        data={resource.data?.items ?? []}
        direction={direction}
        emptyDescription="Накладные создаются только для оплаченных или находящихся в работе заказов."
        emptyTitle="Накладных пока нет"
        loading={resource.loading}
        onSort={(nextSort, nextDirection) => { setOffset(0); setSort(nextSort); setDirection(nextDirection); }}
        sort={sort}
        sortable={["amountKopeks", "createdAt", "invoiceNumber", "status"]}
      />
      {resource.data ? <Pagination limit={limit} offset={offset} onChange={setOffset} total={resource.data.total} /> : null}
    </>
  );
}
