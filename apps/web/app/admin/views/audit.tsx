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

/** Plain-Russian names for the events staff actually see; the raw code stays underneath for search. */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  "auth.login.failed": "Неудачная попытка входа",
  "auth.login.succeeded": "Вход по паролю",
  "auth.logout": "Выход",
  "auth.mfa.verified": "Вход подтверждён кодом",
  "auth.password.changed": "Смена пароля",
  "auth.registration.requested": "Регистрация покупателя",
  "auth.totp.confirmed": "Подключён вход по коду",
  "auth.totp.setup_started": "Начата настройка входа по коду",
  "catalog.import.applied": "Применена выгрузка 1С",
  "catalog.import.rolled_back": "Отменена выгрузка 1С",
  "integration.one_c.settings_updated": "Изменены настройки обмена с 1С",
  "order.status_changed": "Изменён статус заказа",
  "owner.bootstrap.created": "Создан владелец",
  "staff.created_by_cli": "Добавлен сотрудник",
};

const AUDIT_ENTITY_LABELS: Record<string, string> = {
  auth_session: "Сеанс входа",
  catalog_import_batch: "Выгрузка 1С",
  integration_endpoint: "Обмен с 1С",
  order: "Заказ",
  staff_member: "Сотрудник",
  user: "Учётная запись",
};

function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

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
    {
      accessorKey: "action",
      cell: ({ row }) => (
        <div className={styles.cellStack}>
          <strong>{auditActionLabel(row.original.action)}</strong>
          <span>{row.original.action}</span>
        </div>
      ),
      header: "Событие",
    },
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
          <strong>{AUDIT_ENTITY_LABELS[row.original.entityType] ?? row.original.entityType}</strong>
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
        description="Кто и когда входил и что менял. Записи нельзя изменить или удалить. Личные данные покупателей и IP-адреса сюда не выводятся."
        eyebrow="Контроль"
        title="Аудит действий"
      />
      <div className={styles.toolbar}>
        <Input aria-label="Точное имя события" contentBefore={<Search20Regular />} onChange={(_event, data) => setAction(data.value)} placeholder="Код события, например order.status_changed" value={action} />
        <Input aria-label="Тип объекта" onChange={(_event, data) => setEntityType(data.value)} placeholder="Тип объекта, например order" value={entityType} />
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
