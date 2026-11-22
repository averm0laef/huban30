"use client";

import { useState } from "react";
import { Badge, Button } from "@fluentui/react-components";
import { ArrowClockwise20Regular } from "@fluentui/react-icons";
import type { ColumnDef } from "@tanstack/react-table";

import { api, queryString } from "../api";
import { DataTable } from "../data-table";
import { formatDate, Pagination, RequestError, useResource } from "../workspace-utils";
import styles from "../workspace.module.css";

export type OneCSource = "one_c" | "one_c_secondary";

export const ONE_C_SOURCE_LABELS: Record<OneCSource, string> = {
  one_c: "Основная база",
  one_c_secondary: "Дополнительная база",
};

interface ExchangeRun {
  containsOnlyChanges: boolean;
  createdAt: string;
  errorMessage: string | null;
  filename: string;
  id: string;
  imagesAttached: number;
  imagesSkipped: number;
  kind: "catalog" | "offers";
  phase: string;
  /** The 1С price type an offers file's prices were taken from; null for catalog files. */
  priceTypeName: string | null;
  rowsInFile: number;
  rowsRejected: number;
  rowsTouched: number;
  rowsUncategorized: number;
  status: "completed" | "failed" | "running";
  updatedAt: string;
}

interface ExchangeRunPage {
  items: ExchangeRun[];
  limit: number;
  offset: number;
  total: number;
}

const STATUS_LABELS: Record<ExchangeRun["status"], string> = {
  completed: "Готово",
  failed: "Ошибка",
  running: "Не завершён",
};

// One plain sentence per status, shown under the badge, so nobody has to
// guess what a state means or what to do about it.
const STATUS_HINTS: Record<ExchangeRun["status"], string> = {
  completed: "Данные на сайте обновлены.",
  failed: "Сайт не принял файл. 1С повторит его при следующем обмене; если ошибка повторяется — передайте текст ошибки администратору.",
  running: "Обмен начат, но 1С ещё не дождалась окончания. Обычно он доходит до конца сам при следующем запуске обмена.",
};

function fileLabel(run: ExchangeRun): string {
  const base = run.filename.split("/").pop()?.toLowerCase() ?? "";
  if (run.kind === "catalog") return "Товары и разделы";
  if (base.startsWith("prices")) return "Цены";
  if (base.startsWith("rests")) return "Остатки";
  return "Цены и остатки";
}

function scopeLabel(run: ExchangeRun): string {
  if (run.status === "failed" && run.rowsInFile === 0) return "Файл не удалось прочитать";
  if (run.containsOnlyChanges) return "Только изменения";
  const label = fileLabel(run);
  if (label === "Товары и разделы") return "Полная выгрузка: товары, которых нет в файле, скрываются с сайта";
  if (label === "Цены") return "Полная выгрузка цен";
  return "Полная выгрузка: остатки товаров, которых нет в файле, обнуляются";
}

/**
 * History of the standard 1С «Обмен с сайтом» runs for one base. These runs
 * apply straight away (1С has no preview step in that protocol), so this
 * table is where staff check that an exchange happened and why it failed.
 */
export function OneCExchangeRuns({ source }: { source: OneCSource }) {
  const [offset, setOffset] = useState(0);
  const limit = 10;
  const resource = useResource(
    () => api<ExchangeRunPage>(`/catalog/1c/exchange-runs${queryString({ limit, offset, source })}`),
    [source, offset],
  );
  const columns: Array<ColumnDef<ExchangeRun>> = [
    {
      id: "file",
      cell: ({ row }) => (
        <div className={styles.cellStack}>
          <strong>{fileLabel(row.original)}</strong>
          <span>{scopeLabel(row.original)}</span>
        </div>
      ),
      header: "Файл",
    },
    { accessorKey: "createdAt", cell: ({ row }) => formatDate(row.original.createdAt), header: "Получен" },
    {
      accessorKey: "status",
      cell: ({ row }) => (
        <div className={styles.cellStack}>
          <Badge
            appearance="tint"
            color={row.original.status === "failed" ? "danger" : row.original.status === "completed" ? "success" : "warning"}
          >
            {STATUS_LABELS[row.original.status]}
          </Badge>
          <span>{row.original.errorMessage ? `Причина: ${row.original.errorMessage.replace(/\.$/u, "")}. ` : ""}{STATUS_HINTS[row.original.status]}</span>
        </div>
      ),
      header: "Статус",
    },
    {
      id: "rows",
      cell: ({ row }) => row.original.rowsInFile === 0 && row.original.status === "failed" ? <span className={styles.muted}>—</span> : (
        <div className={styles.cellStack}>
          <strong>{row.original.rowsTouched} изменено из {row.original.rowsInFile}</strong>
          <span>
            {row.original.rowsRejected > 0
              ? `${row.original.rowsRejected} не принято (например, цена для товара, которого нет на сайте, или группа, которой нет в выгрузке)`
              : "все записи приняты"}
            {row.original.kind === "catalog" && row.original.rowsUncategorized > 0
              ? ` · ${row.original.rowsUncategorized} без категории` : ""}
            {row.original.imagesAttached + row.original.imagesSkipped > 0
              ? ` · фото: ${row.original.imagesAttached} добавлено, ${row.original.imagesSkipped} пропущено` : ""}
            {row.original.kind === "offers"
              ? ` · вид цен: ${row.original.priceTypeName ?? "не определён — цены из файла не взяты"}` : ""}
          </span>
        </div>
      ),
      header: "Записи",
    },
  ];

  return (
    <section aria-labelledby={`one-c-runs-${source}`} className={styles.settingsForm}>
      <div className={styles.settingsHeading}>
        <div>
          <h2 id={`one-c-runs-${source}`}>Журнал обменов: {ONE_C_SOURCE_LABELS[source]}</h2>
          <p>Что и когда присылала 1С. Данные применяются сразу. «Изменено» — сколько записей действительно что-то поменяли на сайте; если в 1С ничего не менялось, там будет 0 — это нормально.</p>
        </div>
        <Button icon={<ArrowClockwise20Regular />} onClick={resource.reload}>Обновить</Button>
      </div>
      {resource.error ? <RequestError error={resource.error} onRetry={resource.reload} /> : null}
      <DataTable
        columns={columns}
        data={resource.data?.items ?? []}
        emptyDescription="Запустите обмен в 1С (узел «Обмен с сайтом» этой базы). Если запись не появилась, проверьте в «Настройках интеграций»: обмен включён, адрес, логин и пароль совпадают с 1С, IP-адрес 1С есть в «Разрешённых сетях»."
        emptyTitle="Обменов ещё не было"
        loading={resource.loading}
      />
      {resource.data && resource.data.total > limit
        ? <Pagination limit={limit} offset={offset} onChange={setOffset} total={resource.data.total} />
        : null}
    </section>
  );
}
