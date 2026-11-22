"use client";

import { useRef, useState } from "react";
import { Badge, Button, MessageBar, MessageBarBody, Select, Spinner } from "@fluentui/react-components";
import { ArrowClockwise20Regular, Checkmark20Regular, Dismiss20Regular } from "@fluentui/react-icons";
import type { ColumnDef } from "@tanstack/react-table";

import { api, queryString } from "../api";
import { DataTable } from "../data-table";
import type { ImportPreview, ImportRow, Page } from "../types";
import { formatDate, Pagination, RequestError, SectionHeader, useResource } from "../workspace-utils";
import styles from "../workspace.module.css";
import { ONE_C_SOURCE_LABELS, OneCExchangeRuns, type OneCSource } from "./one-c-exchange-runs";
import { OneCGroupMapping } from "./one-c-group-mapping";

interface PendingAction { action: "apply" | "rollback"; batch: ImportRow }

const IMPORT_STATUS_LABELS: Record<string, string> = {
  applied: "Применён",
  applying: "Применяется",
  failed: "Ошибка",
  rolled_back: "Отменён",
  uploaded: "Загружен",
  validated: "Проверен",
  validating: "Проверяется",
};

const IMPORT_ROW_STATUS_LABELS: Record<string, string> = {
  applied: "Применена",
  invalid: "Ошибка",
  pending: "Ожидает",
  skipped: "Пропущена",
  valid: "Корректна",
};

export function ImportsView() {
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [exchangeSource, setExchangeSource] = useState<OneCSource>("one_c");
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<unknown>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const previewRequest = useRef(0);
  const limit = 25;
  const resource = useResource(
    () => api<Page<ImportRow>>(`/catalog/imports${queryString({ limit, offset, status: status || undefined })}`),
    [offset, status],
  );

  async function confirmAction(): Promise<void> {
    if (!pending) return;
    setBusy(true);
    setMutationError(null);
    try {
      await api(`/catalog/imports/${pending.batch.id}/${pending.action}`, { method: "POST" });
      setPending(null);
      resource.reload();
    } catch (error) {
      setMutationError(error);
    } finally {
      setBusy(false);
    }
  }

  async function openPreview(batchId: string): Promise<void> {
    const requestId = ++previewRequest.current;
    setPreviewId(batchId);
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const nextPreview = await api<ImportPreview>(`/catalog/imports/${batchId}?limit=50&offset=0`);
      if (requestId === previewRequest.current) setPreview(nextPreview);
    } catch (error) {
      if (requestId === previewRequest.current) setPreviewError(error);
    } finally {
      if (requestId === previewRequest.current) setPreviewLoading(false);
    }
  }

  const columns: Array<ColumnDef<ImportRow>> = [
    {
      accessorKey: "externalBatchId",
      cell: ({ row }) => <strong>{row.original.externalBatchId}</strong>,
      header: "Пакет 1С",
    },
    { accessorKey: "uploadedAt", cell: ({ row }) => formatDate(row.original.uploadedAt), header: "Загружен" },
    {
      accessorKey: "status",
      cell: ({ row }) => <Badge appearance="tint" color={row.original.status === "failed" ? "danger" : row.original.status === "applied" ? "success" : "informative"}>{IMPORT_STATUS_LABELS[row.original.status] ?? row.original.status}</Badge>,
      header: "Статус",
    },
    {
      id: "rows",
      cell: ({ row }) => (
        <div className={styles.cellStack}>
          <strong>{row.original.totalRows} строк</strong>
          <span>{row.original.validRows} валидных, {row.original.invalidRows} с ошибками</span>
        </div>
      ),
      header: "Проверка",
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <div className={styles.rowActions}>
          <Button appearance="subtle" onClick={() => void openPreview(row.original.id)} size="small">Предпросмотр</Button>
          {row.original.status === "validated" && row.original.invalidRows === 0 ? (
            <Button appearance="subtle" onClick={() => setPending({ action: "apply", batch: row.original })} size="small">Применить</Button>
          ) : null}
          {row.original.status === "applied" ? (
            <Button appearance="subtle" onClick={() => setPending({ action: "rollback", batch: row.original })} size="small">Откатить</Button>
          ) : null}
          {!(["validated", "applied"].includes(row.original.status)) ? <span className={styles.muted}>Нет действий</span> : null}
        </div>
      ),
      header: "Действия",
    },
  ];

  return (
    <>
      <SectionHeader
        actions={<Button icon={<ArrowClockwise20Regular />} onClick={resource.reload}>Обновить</Button>}
        description="Обычный «Обмен с сайтом» из 1С применяется сразу — его результат виден в журнале обменов. Ниже — пакеты особой обработки 1С: их можно сначала просмотреть, затем применить вручную или отменить."
        eyebrow="Интеграция"
        title="Импорт из 1С"
      />
      <div className={styles.toolbar} aria-label="База 1С для журнала обменов">
        {(["one_c", "one_c_secondary"] as const).map((value) => (
          <Button
            appearance={exchangeSource === value ? "primary" : "secondary"}
            aria-pressed={exchangeSource === value}
            key={value}
            onClick={() => setExchangeSource(value)}
          >
            {ONE_C_SOURCE_LABELS[value]}
          </Button>
        ))}
      </div>
      <OneCExchangeRuns key={exchangeSource} source={exchangeSource} />
      <OneCGroupMapping />
      <div className={styles.settingsHeading}>
        <div>
          <h2>Пакеты с ручным применением</h2>
          <p>Нужны, только если программист настроил в основной базе 1С отдельную обработку выгрузки. При обычном «Обмене с сайтом» этот список остаётся пустым — это нормально.</p>
        </div>
      </div>
      <div className={styles.toolbar}>
        <Select aria-label="Статус выгрузки" onChange={(event) => { setOffset(0); setStatus(event.target.value); }} value={status}>
          <option value="">Все статусы</option>
          <option value="uploaded">Загружены</option>
          <option value="validating">Проверяются</option>
          <option value="validated">Проверены</option>
          <option value="applying">Применяются</option>
          <option value="applied">Применены</option>
          <option value="failed">С ошибкой</option>
          <option value="rolled_back">Отменены</option>
        </Select>
      </div>
      {pending ? (
        <MessageBar intent={pending.action === "rollback" ? "warning" : "info"} className={styles.confirmBar}>
          <MessageBarBody>
            {pending.action === "apply"
              ? `Применить пакет ${pending.batch.externalBatchId} к каталогу?`
              : `Откатить пакет ${pending.batch.externalBatchId}? Изменения будут восстановлены из журнала ревизии.`}
          </MessageBarBody>
          <Button disabled={busy} icon={<Checkmark20Regular />} onClick={() => void confirmAction()}>Подтвердить</Button>
          <Button disabled={busy} icon={<Dismiss20Regular />} onClick={() => setPending(null)}>Отмена</Button>
        </MessageBar>
      ) : null}
      {resource.error ? <RequestError error={resource.error} onRetry={resource.reload} /> : null}
      {mutationError ? <RequestError error={mutationError} onRetry={resource.reload} /> : null}
      <DataTable
        columns={columns}
        data={resource.data?.items ?? []}
        emptyDescription="Если вы пользуетесь обычным «Обменом с сайтом», ничего делать не нужно: смотрите журнал обменов выше."
        emptyTitle="Пакетов с ручным применением нет"
        loading={resource.loading}
      />
      {resource.data ? <Pagination limit={limit} offset={offset} onChange={setOffset} total={resource.data.total} /> : null}
      {previewLoading ? <div className={styles.previewPanel}><Spinner label="Загрузка предпросмотра" /></div> : null}
      {previewError && previewId ? <RequestError error={previewError} onRetry={() => void openPreview(previewId)} /> : null}
      {preview ? (
        <section className={styles.previewPanel} aria-labelledby="import-preview-title">
          <div className={styles.previewHeader}>
            <div>
              <span className={styles.eyebrow}>Пакет {preview.externalBatchId}</span>
              <h2 id="import-preview-title">Предпросмотр изменений</h2>
              <p>{preview.validRows} корректных, {preview.invalidRows} с ошибками, {preview.skippedRows} пропущено.</p>
            </div>
            <Button onClick={() => { previewRequest.current += 1; setPreviewLoading(false); setPreview(null); setPreviewId(null); }}>Закрыть</Button>
          </div>
          {Object.keys(preview.conflicts).length > 0 ? (
            <dl className={styles.conflictList}>
              {Object.entries(preview.conflicts).map(([code, count]) => <div key={code}><dt>{code}</dt><dd>{count}</dd></div>)}
            </dl>
          ) : <p className={styles.muted}>Конфликты не обнаружены.</p>}
          <div className={styles.tableScroller} tabIndex={0} aria-label="Строки предпросмотра импорта">
            <table className={styles.dataTable}>
              <thead><tr><th scope="col">Строка</th><th scope="col">Сущность</th><th scope="col">Код 1С</th><th scope="col">Изменение</th><th scope="col">Проверка</th></tr></thead>
              <tbody>
                {preview.page.rows.map((row) => (
                  <tr key={row.row_number}>
                    <td>{row.row_number}</td>
                    <td>{row.entity_type}</td>
                    <td>{row.external_id ?? "Не определён"}</td>
                    <td>{row.change_kind ?? "Без изменения"}</td>
                    <td>
                      <div className={styles.cellStack}>
                        <strong>{IMPORT_ROW_STATUS_LABELS[row.status] ?? row.status}</strong>
                        {row.validation_errors?.map((issue) => <span key={`${issue.code}:${issue.message}`}>{issue.message}</span>)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.page.rows.length === 0 ? <p className={styles.muted}>В пакете нет строк для предпросмотра.</p> : null}
          {preview.totalRows > preview.page.rows.length ? <p className={styles.muted}>Показаны первые {preview.page.rows.length} из {preview.totalRows} строк.</p> : null}
        </section>
      ) : null}
    </>
  );
}
