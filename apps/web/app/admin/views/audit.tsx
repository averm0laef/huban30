"use client";

import { useMemo, useState } from "react";
import { Button, Input } from "@fluentui/react-components";
import { ArrowClockwise20Regular, Search20Regular } from "@fluentui/react-icons";
import type { ColumnDef } from "@tanstack/react-table";

import { api, queryString } from "../api";
import { DataTable } from "../data-table";
import type { AuditRow, Page } from "../types";
import { formatDate, Pagination, RequestError, ROLE_LABELS, SectionHeader, useResource } from "../workspace-utils";
import styles from "../workspace.module.css";

export function AuditView() {
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [applied, setApplied] = useState({ action: "", entityType: "" });
  const invalidSearch = action.trim().length === 1 || entityType.trim().length === 1;
  const limit = 25;
  const resource = useResource(
    () => api<Page<AuditRow>>(`/staff/audit${queryString({
      action: applied.action || undefined,
      entityType: applied.entityType || undefined,
      limit,
      offset,
    })}`),
    [applied.action, applied.entityType, offset],
  );
  const columns = useMemo<Array<ColumnDef<AuditRow>>>(() => [
    { accessorKey: "createdAt", cell: ({ row }) => formatDate(row.original.createdAt), header: "Время" },
    { accessorKey: "action", cell: ({ row }) => <strong>{row.original.action}</strong>, header: "Событие" },
    {
      id: "actor",
      cell: ({ row }) => (
        <div className={styles.cellStack}>
          <strong>{row.original.actorEmail ?? "Система"}</strong>
          <span>{row.original.actorRole ? ROLE_LABELS[row.original.actorRole] : "Без роли"}</span>
        </div>
      ),
      header: "Инициатор",
    },
    {
      id: "entity",
      cell: ({ row }) => (
        <div className={styles.cellStack}>
          <strong>{row.original.entityType}</strong>
          <span>{row.original.entityId ?? "Без идентификатора"}</span>
        </div>
      ),
      header: "Объект",
    },
  ], []);

  return (
    <>
      <SectionHeader
        actions={<Button icon={<ArrowClockwise20Regular />} onClick={resource.reload}>Обновить</Button>}
        description="Неизменяемый журнал. Чувствительные снимки, IP-адреса и данные браузера не передаются в этот список."
        eyebrow="Контроль"
        title="Аудит действий"
      />
      <div className={styles.toolbar}>
        <Input aria-label="Точное имя события" contentBefore={<Search20Regular />} onChange={(_event, data) => setAction(data.value)} placeholder="order.status_changed" value={action} />
        <Input aria-label="Тип объекта" onChange={(_event, data) => setEntityType(data.value)} placeholder="order" value={entityType} />
        <Button disabled={invalidSearch} onClick={() => { setOffset(0); setApplied({ action: action.trim(), entityType: entityType.trim() }); }}>Применить</Button>
        {action !== applied.action || entityType !== applied.entityType ? <span className={styles.unsavedState}>Фильтры не применены</span> : null}
        {invalidSearch ? <span className={styles.unsavedState}>Введите минимум 2 символа</span> : null}
      </div>
      {resource.error ? <RequestError error={resource.error} onRetry={resource.reload} /> : null}
      <DataTable
        columns={columns}
        data={resource.data?.items ?? []}
        emptyDescription="Для выбранных точных фильтров событий нет."
        emptyTitle="Записи не найдены"
        loading={resource.loading}
      />
      {resource.data ? <Pagination limit={limit} offset={offset} onChange={setOffset} total={resource.data.total} /> : null}
    </>
  );
}
