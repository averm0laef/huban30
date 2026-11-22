"use client";

import { useState } from "react";
import { Button, Spinner } from "@fluentui/react-components";
import { ArrowClockwise20Regular } from "@fluentui/react-icons";

import { api, queryString } from "../api";
import { formatDate, Pagination, RequestError, useResource } from "../workspace-utils";
import styles from "../workspace.module.css";
import { ONE_C_SOURCE_LABELS, type OneCSource } from "./one-c-exchange-runs";
import { plainAddress, rejectionText, type RejectedRequest } from "./one-c-rejections";

interface RejectedRequestPage {
  items: RejectedRequest[];
  limit: number;
  offset: number;
  total: number;
}

/**
 * Requests of one base that the site did not let in: when, from which address, what was wrong and what to put
 * right. 1С shows only «ошибка авторизации» for all of them, and a request turned away at the door never reaches
 * the journal of exchanges above — without this list a failed connection leaves no trace the owner can read.
 */
export function OneCRejectedRequests({ source }: { source: OneCSource }) {
  const [offset, setOffset] = useState(0);
  const limit = 10;
  const resource = useResource(
    () => api<RejectedRequestPage>(`/catalog/1c/requests${queryString({ limit, offset, source, succeeded: "false" })}`),
    [source, offset],
  );
  const items = resource.data?.items ?? [];

  return (
    <section aria-labelledby={`one-c-rejected-${source}`} className={styles.settingsForm}>
      <div className={styles.settingsHeading}>
        <div>
          <h2 id={`one-c-rejected-${source}`}>Отказы на входе: {ONE_C_SOURCE_LABELS[source]}</h2>
          <p>Обращения, которые сайт не принял. 1С в таких случаях показывает только «ошибка авторизации» — здесь видно, с какого адреса она обращалась и что поправить. Посторонние запросы попадают сюда же: по ним делать ничего не нужно.</p>
        </div>
        <Button icon={<ArrowClockwise20Regular />} onClick={resource.reload}>Обновить</Button>
      </div>
      {resource.error ? <RequestError error={resource.error} onRetry={resource.reload} /> : null}
      {/* A list, not the shared table: each entry is two sentences, and the table cut them off. */}
      {resource.loading ? (
        <div className={styles.tableState} role="status"><Spinner size="small" label="Загрузка данных" /></div>
      ) : items.length === 0 ? (
        <div className={styles.tableState}>
          <strong>Отказов не было</strong>
          <span>Сайт не отклонил ни одного обращения этой базы. Если обмен в 1С не проходит, а здесь пусто, значит 1С до сайта не дошла: проверьте в её настройках адрес обмена.</span>
        </div>
      ) : (
        <ol className={styles.journalList}>
          {items.map((request) => {
            const text = rejectionText(request);
            return (
              <li className={styles.journalEntry} key={request.id}>
                <div className={styles.journalMeta}>
                  <span>{formatDate(request.createdAt)}</span>
                  <span>адрес {plainAddress(request.ipAddress)}</span>
                  <span>ответ сайта {request.statusCode}</span>
                </div>
                <strong>{text.what}</strong>
                <p>{text.todo}</p>
              </li>
            );
          })}
        </ol>
      )}
      {resource.data && resource.data.total > limit
        ? <Pagination limit={limit} offset={offset} onChange={setOffset} total={resource.data.total} />
        : null}
    </section>
  );
}
