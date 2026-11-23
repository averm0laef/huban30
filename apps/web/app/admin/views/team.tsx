"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Input, MessageBar, MessageBarBody, Select } from "@fluentui/react-components";
import { ArrowClockwise20Regular, MailAdd20Regular, Search20Regular } from "@fluentui/react-icons";
import type { ColumnDef } from "@tanstack/react-table";

import { canOpenSection, NAVIGATION, STAFF_ROLES } from "../navigation";
import { api, queryString } from "../api";
import { DataTable } from "../data-table";
import type { Page, SessionView, TeamRow } from "../types";
import { formatDate, Pagination, RequestError, ROLE_LABELS, SectionHeader, useResource } from "../workspace-utils";
import styles from "../workspace.module.css";

const STAFF_STATUS_LABELS: Record<string, string> = {
  active: "Работает",
  invited: "Приглашён",
  suspended: "Приостановлен",
  terminated: "Уволен",
};

export function TeamView({ session }: { session: SessionView }) {
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("manager");
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<unknown>(null);
  const [success, setSuccess] = useState("");
  const limit = 25;
  const resource = useResource(
    () => api<Page<TeamRow>>(`/staff/team${queryString({ limit, offset, q: appliedSearch || undefined, role: role || undefined })}`),
    [offset, appliedSearch, role],
  );

  async function invite(): Promise<void> {
    setBusy(true);
    setMutationError(null);
    setSuccess("");
    try {
      await api<{ message: string }>("/auth/staff/invitations", {
        body: JSON.stringify({ email: email.trim(), role: inviteRole }),
        method: "POST",
      });
      setEmail("");
      setSuccess("Приглашение создано и передано в очередь отправки.");
    } catch (error) {
      setMutationError(error);
    } finally {
      setBusy(false);
    }
  }

  const columns = useMemo<Array<ColumnDef<TeamRow>>>(() => [
    {
      accessorKey: "displayName",
      cell: ({ row }) => (
        <div className={styles.cellStack}>
          <strong>{row.original.displayName ?? "Имя не указано"}</strong>
          <span>{row.original.email}</span>
        </div>
      ),
      header: "Сотрудник",
    },
    { accessorKey: "role", cell: ({ row }) => ROLE_LABELS[row.original.role], header: "Роль" },
    { id: "position", cell: ({ row }) => row.original.positionTitle ?? "Не указана", header: "Должность" },
    { accessorKey: "status", cell: ({ row }) => <Badge appearance="tint">{STAFF_STATUS_LABELS[row.original.status] ?? row.original.status}</Badge>, header: "Статус" },
    {
      id: "mfa",
      cell: ({ row }) => <Badge appearance="tint" color={row.original.totpEnabled ? "success" : "danger"}>{row.original.totpEnabled ? "Включена" : "Не настроена"}</Badge>,
      header: "Вход по коду",
    },
    { accessorKey: "createdAt", cell: ({ row }) => formatDate(row.original.createdAt, false), header: "Добавлен" },
  ], []);

  return (
    <>
      <SectionHeader
        actions={<Button icon={<ArrowClockwise20Regular />} onClick={resource.reload}>Обновить</Button>}
        description="Кто работает в рабочем месте и подключил ли вход по коду из приложения. Ключи и резервные коды сотрудников здесь не показываются."
        eyebrow="Доступ"
        title="Персонал"
      />
      {session.role === "admin" ? (
        <div className={styles.createStrip}>
          <div><strong>Пригласить сотрудника</strong><span>Сотрудник получит письмо со ссылкой. Ссылка действует 72 часа.</span></div>
          <Input aria-label="Email сотрудника" onChange={(_event, data) => setEmail(data.value)} placeholder="employee@example.ru" type="email" value={email} />
          <Select aria-label="Роль приглашения" onChange={(event) => setInviteRole(event.target.value)} value={inviteRole}>
            <option value="manager">Менеджер</option>
            <option value="director">Директор</option>
            <option value="admin">Администратор</option>
          </Select>
          <Button appearance="primary" disabled={busy || !email.trim()} icon={<MailAdd20Regular />} onClick={() => void invite()}>Пригласить</Button>
          {email ? <span className={styles.unsavedState}>Приглашение ещё не создано</span> : null}
        </div>
      ) : null}
      {success ? <MessageBar intent="success"><MessageBarBody>{success}</MessageBarBody></MessageBar> : null}
      <div className={styles.toolbar}>
        <Input
          aria-label="Поиск сотрудников"
          contentBefore={<Search20Regular />}
          onChange={(_event, data) => setSearch(data.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && search.trim().length !== 1) setAppliedSearch(search.trim()); }}
          placeholder="Имя, email или код"
          value={search}
        />
        <Button disabled={search.trim().length === 1} onClick={() => { setOffset(0); setAppliedSearch(search.trim()); }}>Найти</Button>
        <Select aria-label="Роль сотрудника" onChange={(event) => { setOffset(0); setRole(event.target.value); }} value={role}>
          <option value="">Все роли</option>
          <option value="manager">Менеджеры</option>
          <option value="director">Директора</option>
          <option value="admin">Администраторы</option>
        </Select>
        {search.trim().length === 1 ? <span className={styles.unsavedState}>Введите минимум 2 символа</span>
          : search.trim() !== appliedSearch ? <span className={styles.unsavedState}>Фильтр не применён</span> : null}
      </div>
      {resource.error ? <RequestError error={resource.error} onRetry={resource.reload} /> : null}
      {mutationError ? <RequestError error={mutationError} onRetry={resource.reload} /> : null}
      <DataTable
        columns={columns}
        data={resource.data?.items ?? []}
        emptyDescription="Создайте первого владельца одноразовой CLI-командой, затем приглашайте сотрудников."
        emptyTitle="Сотрудники не найдены"
        loading={resource.loading}
      />
      {resource.data ? <Pagination limit={limit} offset={offset} onChange={setOffset} total={resource.data.total} /> : null}
      <AccessMatrix ownRole={session.role} />
    </>
  );
}

/**
 * Who sees which section. Built from the same list as the menu and the same role permissions the server
 * checks, so the table cannot promise an access the server would refuse.
 */
function AccessMatrix({ ownRole }: { ownRole: SessionView["role"] }) {
  return (
    <section aria-labelledby="access-matrix-title" className={styles.accessMatrix}>
      <header>
        <h2 id="access-matrix-title">Что видит каждая роль</h2>
        <p>Роль выбирается при приглашении. Закрытый раздел не показывается в меню, а сервер не отдаёт его данные и по прямой ссылке.</p>
      </header>
      <div className={styles.accessScroller} role="region" aria-labelledby="access-matrix-title" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th scope="col">Раздел</th>
              {STAFF_ROLES.map((role) => (
                <th data-own={role === ownRole || undefined} key={role} scope="col">{ROLE_LABELS[role]}{role === ownRole ? <small>ваша роль</small> : null}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NAVIGATION.map((item) => (
              <tr key={item.section}>
                <th scope="row">{item.label}<small>{item.about}</small></th>
                {STAFF_ROLES.map((role) => {
                  const open = canOpenSection(role, item.section);
                  return <td data-open={open || undefined} data-own={role === ownRole || undefined} key={role}>{open ? "Да" : "Нет"}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.muted}>Сверх разделов: приглашать сотрудников и подключать площадки может только администратор; удалять чаты — директор и администратор.</p>
    </section>
  );
}
