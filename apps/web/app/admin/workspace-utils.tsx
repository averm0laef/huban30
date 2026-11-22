"use client";

import { useCallback, useEffect, useState, type DependencyList, type ReactNode } from "react";
import {
  Button,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
} from "@fluentui/react-components";
import { ArrowClockwise20Regular } from "@fluentui/react-icons";

import type { OrderStatus } from "@an30/contracts";

import { ApiError } from "./api";
import styles from "./workspace.module.css";

export const ORDER_LABELS: Record<OrderStatus, string> = {
  awaiting_confirmation: "Новая заявка",
  awaiting_delivery_terms: "Условия доставки",
  cancelled: "Отменён",
  completed: "Завершён",
  processing: "В работе",
  ready: "Готов",
};

export const CHAT_LABELS = {
  closed: "Закрыт",
  open: "Открыт",
  waiting_customer: "Ждём клиента",
  waiting_staff: "Ждёт сотрудника",
} as const;

export const INVOICE_LABELS = {
  cancelled: "Аннулирована",
  draft: "Черновик",
  issued: "Выдана",
} as const;

export const ROLE_LABELS = {
  admin: "Администратор",
  customer: "Клиент",
  director: "Директор",
  manager: "Менеджер",
} as const;

export function formatMoney(value: number | null): string {
  if (value === null) return "Нет цены";
  return new Intl.NumberFormat("ru-RU", { currency: "RUB", style: "currency" }).format(value / 100);
}

export function formatDate(value: string | null, withTime = true): string {
  if (!value) return "Нет данных";
  return new Intl.DateTimeFormat("ru-RU", withTime
    ? { dateStyle: "short", timeStyle: "short" }
    : { dateStyle: "medium" }).format(new Date(value));
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Неизвестная ошибка";
}

export function useResource<T>(load: () => Promise<T>, dependencies: DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    load()
      .then((value) => { if (!controller.signal.aborted) setData(value); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // The caller explicitly controls reload dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, revision]);

  return { data, error, loading, reload, setData };
}

export function SectionHeader({
  actions,
  description,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <header className={styles.sectionHeader}>
      <div>
        <span className={styles.eyebrow}>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className={styles.headerActions}>{actions}</div> : null}
    </header>
  );
}

export function RequestError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const conflict = error instanceof ApiError && error.status === 409;
  return (
    <MessageBar intent={conflict ? "warning" : "error"} className={styles.messageBar}>
      <MessageBarBody>
        <MessageBarTitle>{conflict ? "Данные изменились" : "Не удалось загрузить данные"}</MessageBarTitle>
        {errorText(error)}
      </MessageBarBody>
      <Button appearance="transparent" icon={<ArrowClockwise20Regular />} onClick={onRetry}>
        Повторить
      </Button>
    </MessageBar>
  );
}

export function Pagination({
  limit,
  offset,
  onChange,
  total,
}: {
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
  total: number;
}) {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div className={styles.pagination}>
      <span>С {from} по {to} из {total}</span>
      <div>
        <Button disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
          Назад
        </Button>
        <Button disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
          Далее
        </Button>
      </div>
    </div>
  );
}
