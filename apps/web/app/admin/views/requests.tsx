"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Input,
  Select,
  Spinner,
} from "@fluentui/react-components";
import {
  ArrowClockwise20Regular,
  CheckmarkCircle20Regular,
  DismissCircle20Regular,
  PersonAvailable20Regular,
  Search20Regular,
} from "@fluentui/react-icons";

import type { ContactRequestStatus } from "@an30/contracts";

import { api, queryString } from "../api";
import type {
  ContactRequestDetail,
  ContactRequestRow,
  ContactRequestSource,
  Page,
  SessionView,
} from "../types";
import {
  formatDate,
  Pagination,
  RequestError,
  SectionHeader,
  useResource,
} from "../workspace-utils";
import styles from "../workspace.module.css";

const STATUS_LABELS: Record<ContactRequestStatus, string> = {
  closed: "Закрыто",
  in_progress: "В работе",
  new: "Новое",
  resolved: "Решено",
};

const SOURCE_LABELS: Record<ContactRequestSource, string> = {
  contacts: "Контакты",
  expert_help: "Помощь эксперта",
  vin_request: "Запрос по VIN",
};

type AssignmentFilter = "any" | "mine" | "unassigned";

export function RequestsView({ session }: { session: SessionView }) {
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [status, setStatus] = useState<"" | ContactRequestStatus>("");
  const [source, setSource] = useState<"" | ContactRequestSource>("");
  const [assigned, setAssigned] = useState<AssignmentFilter>("any");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContactRequestDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<unknown>(null);
  const [mutationError, setMutationError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const detailRequest = useRef(0);
  const mutationInFlight = useRef(false);
  const selectedIdRef = useRef<string | null>(null);
  const limit = 25;

  const openRequest = useCallback(async (requestId: string, updateLocation = true): Promise<void> => {
    const requestNumber = detailRequest.current + 1;
    detailRequest.current = requestNumber;
    selectedIdRef.current = requestId;
    setSelectedId(requestId);
    setDetail(null);
    setDetailError(null);
    setMutationError(null);
    setDetailLoading(true);
    if (updateLocation) {
      const parameters = new URLSearchParams(window.location.search);
      parameters.set("request", requestId);
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?${parameters.toString()}`);
    }
    try {
      const loaded = await api<ContactRequestDetail>(`/staff/requests/${requestId}`);
      if (detailRequest.current === requestNumber) setDetail(loaded);
    } catch (error) {
      if (detailRequest.current === requestNumber) setDetailError(error);
    } finally {
      if (detailRequest.current === requestNumber) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const requestedAssignment = parameters.get("assigned");
    const requestedStatus = parameters.get("status");
    const requestedSource = parameters.get("source");
    const requestedSearch = parameters.get("q")?.trim() ?? "";
    const requestedId = parameters.get("request");
    if (requestedAssignment && ["any", "mine", "unassigned"].includes(requestedAssignment)) {
      setAssigned(requestedAssignment as AssignmentFilter);
    }
    if (requestedStatus && Object.hasOwn(STATUS_LABELS, requestedStatus)) {
      setStatus(requestedStatus as ContactRequestStatus);
    }
    if (requestedSource && Object.hasOwn(SOURCE_LABELS, requestedSource)) {
      setSource(requestedSource as ContactRequestSource);
    }
    if (requestedSearch.length === 0 || requestedSearch.length >= 2) {
      setSearch(requestedSearch);
      setAppliedSearch(requestedSearch);
    }
    if (requestedId) void openRequest(requestedId, false);
  }, [openRequest]);

  const resource = useResource(
    () => api<Page<ContactRequestRow>>(`/staff/requests${queryString({
      assigned,
      limit,
      offset,
      q: appliedSearch || undefined,
      source: source || undefined,
      status: status || undefined,
    })}`),
    [assigned, offset, appliedSearch, source, status],
  );

  function closeDetail(): void {
    detailRequest.current += 1;
    selectedIdRef.current = null;
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
    setMutationError(null);
    const parameters = new URLSearchParams(window.location.search);
    parameters.delete("request");
    const query = parameters.toString();
    window.history.replaceState(
      window.history.state,
      "",
      query ? `${window.location.pathname}?${query}` : window.location.pathname,
    );
  }

  async function updateRequest(
    update: { assignedStaffId?: string | null; status?: ContactRequestStatus },
    reason: string,
  ): Promise<void> {
    if (!detail || mutationInFlight.current) return;
    const updatedId = detail.id;
    mutationInFlight.current = true;
    setBusy(true);
    setMutationError(null);
    try {
      await api(`/staff/requests/${updatedId}`, {
        body: JSON.stringify({ ...update, reason, version: detail.version }),
        method: "PATCH",
      });
      resource.reload();
      if (selectedIdRef.current === updatedId) await openRequest(updatedId, false);
    } catch (error) {
      setMutationError(error);
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
    }
  }

  const elevated = session.role === "director" || session.role === "admin";
  const canChangeStatus = Boolean(detail && (
    elevated
    || (detail.assignedStaffId === session.userId && ["new", "in_progress"].includes(detail.status))
  ));

  function reloadAll(): void {
    resource.reload();
    if (selectedId) void openRequest(selectedId, false);
  }

  return (
    <>
      <SectionHeader
        actions={<Button disabled={busy} icon={<ArrowClockwise20Regular />} onClick={reloadAll}>Обновить очередь</Button>}
        description="Заявки из контактов, помощи эксперта и поиска по VIN собраны в одной очереди."
        eyebrow="Клиенты"
        title="Обращения"
      />
      <div className={styles.toolbar}>
        <Input
          aria-label="Поиск обращений"
          contentBefore={<Search20Regular />}
          onChange={(_event, data) => setSearch(data.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && search.trim().length !== 1) {
              setOffset(0);
              setAppliedSearch(search.trim());
            }
          }}
          placeholder="Имя, email, телефон или текст"
          value={search}
        />
        <Button
          disabled={search.trim().length === 1}
          onClick={() => { setOffset(0); setAppliedSearch(search.trim()); }}
        >
          Найти
        </Button>
        <Select
          aria-label="Статус обращения"
          onChange={(event) => { setOffset(0); setStatus(event.target.value as "" | ContactRequestStatus); }}
          value={status}
        >
          <option value="">Все статусы</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Select
          aria-label="Источник обращения"
          onChange={(event) => { setOffset(0); setSource(event.target.value as "" | ContactRequestSource); }}
          value={source}
        >
          <option value="">Все источники</option>
          {Object.entries(SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Select
          aria-label="Ответственный за обращение"
          onChange={(event) => { setOffset(0); setAssigned(event.target.value as AssignmentFilter); }}
          value={assigned}
        >
          <option value="any">Все ответственные</option>
          <option value="mine">Назначены мне</option>
          <option value="unassigned">Без ответственного</option>
        </Select>
        {search.trim().length === 1 ? <span className={styles.unsavedState}>Введите минимум 2 символа</span>
          : search.trim() !== appliedSearch ? <span className={styles.unsavedState}>Фильтр не применён</span> : null}
      </div>
      {resource.error ? <RequestError error={resource.error} onRetry={resource.reload} /> : null}
      <div className={styles.requestWorkspace}>
        <section className={styles.threadQueue} aria-label="Очередь обращений клиентов">
          {resource.loading ? <div className={styles.loadingPanel}><Spinner label="Загрузка обращений" /></div> : null}
          {!resource.loading && !resource.error && (resource.data?.items.length ?? 0) === 0 ? (
            <div className={styles.tableState}>
              <strong>Обращений не найдено</strong>
              <span>Измените фильтры или дождитесь новой заявки.</span>
            </div>
          ) : null}
          {resource.data?.items.map((request) => (
            <button
              aria-pressed={request.id === selectedId}
              className={styles.threadCard}
              data-active={request.id === selectedId || undefined}
              disabled={busy}
              key={request.id}
              onClick={() => void openRequest(request.id)}
              type="button"
            >
              <span className={styles.threadTopline}>
                <strong>{request.customerNameMasked}</strong>
                <Badge appearance="tint">{STATUS_LABELS[request.status]}</Badge>
              </span>
              <span>
                {SOURCE_LABELS[request.source]} · {request.customerEmailMasked ?? request.customerPhoneMasked ?? "Контакт скрыт"}
              </span>
              <small>Текст обращения: {request.messageLength} символов</small>
              <span className={styles.threadMeta}>
                <span>{request.assignedName ?? "Без ответственного"}</span>
                <time dateTime={request.createdAt}>{formatDate(request.createdAt)}</time>
              </span>
            </button>
          ))}
          {resource.data ? <Pagination limit={limit} offset={offset} onChange={setOffset} total={resource.data.total} /> : null}
        </section>
        <section
          aria-busy={busy}
          aria-label="Карточка обращения"
          aria-live="polite"
          className={styles.requestDetail}
        >
          {!selectedId ? (
            <div className={styles.tableState}>
              <strong>Выберите обращение</strong>
              <span>Контакты, сообщение и доступные действия откроются здесь.</span>
            </div>
          ) : detailLoading ? (
            <div className={styles.loadingPanel}><Spinner label="Загрузка обращения" /></div>
          ) : detailError ? (
            <div className={styles.requestErrorState}>
              <RequestError error={detailError} onRetry={() => void openRequest(selectedId, false)} />
              <Button onClick={closeDetail}>Закрыть карточку</Button>
            </div>
          ) : detail ? (
            <>
              <header className={styles.conversationHeader}>
                <div>
                  <strong>{detail.customerName}</strong>
                  <span>{SOURCE_LABELS[detail.source]}, создано {formatDate(detail.createdAt)}</span>
                </div>
                <Button disabled={busy} onClick={closeDetail}>Закрыть карточку</Button>
              </header>
              <div className={styles.threadActions}>
                {detail.assignedStaffId === session.userId ? (
                  <Button
                    disabled={busy}
                    onClick={() => void updateRequest(
                      { assignedStaffId: null },
                      "Сотрудник снял с себя обращение",
                    )}
                  >
                    Снять назначение
                  </Button>
                ) : detail.assignedStaffId === null || elevated ? (
                  <>
                    <Button
                      disabled={busy}
                      icon={<PersonAvailable20Regular />}
                      onClick={() => void updateRequest(
                        { assignedStaffId: session.userId },
                        "Сотрудник взял обращение в работу",
                      )}
                    >
                      Взять себе
                    </Button>
                    {elevated && detail.assignedStaffId !== null ? (
                      <Button
                        disabled={busy}
                        onClick={() => void updateRequest(
                          { assignedStaffId: null },
                          "Руководитель снял назначение с обращения",
                        )}
                      >
                        Снять текущее назначение
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <span className={styles.muted}>Назначено: {detail.assignedName ?? "другой сотрудник"}</span>
                )}
                {canChangeStatus ? (
                  <StatusActions
                    busy={busy}
                    elevated={elevated}
                    onUpdate={updateRequest}
                    status={detail.status}
                  />
                ) : detail.status === "new" || detail.status === "in_progress" ? (
                  <span className={styles.muted}>Чтобы изменить статус, возьмите обращение себе.</span>
                ) : <span className={styles.muted}>Вернуть завершённое обращение может руководитель.</span>}
              </div>
              {mutationError ? (
                <RequestError
                  error={mutationError}
                  onRetry={() => {
                    resource.reload();
                    void openRequest(detail.id, false);
                  }}
                />
              ) : null}
              <div className={styles.requestBody}>
                <dl className={styles.detailList}>
                  <div><dt>Статус</dt><dd><Badge appearance="tint">{STATUS_LABELS[detail.status]}</Badge></dd></div>
                  <div><dt>Ответственный</dt><dd>{detail.assignedName ?? "Не назначен"}</dd></div>
                  <div><dt>Email</dt><dd>{detail.customerEmail ? <a href={`mailto:${detail.customerEmail}`}>{detail.customerEmail}</a> : "Не указан"}</dd></div>
                  <div><dt>Телефон</dt><dd>{detail.customerPhone ? <a href={`tel:${detail.customerPhone.replace(/[^+\d]/gu, "")}`}>{detail.customerPhone}</a> : "Не указан"}</dd></div>
                  <div><dt>Обновлено</dt><dd>{formatDate(detail.updatedAt)}</dd></div>
                  {detail.resolvedAt ? <div><dt>Решено</dt><dd>{formatDate(detail.resolvedAt)}</dd></div> : null}
                </dl>
                <div className={styles.requestMessage}>
                  <h2>Сообщение клиента</h2>
                  <p>{detail.message}</p>
                </div>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </>
  );
}

function StatusActions({
  busy,
  elevated,
  onUpdate,
  status,
}: {
  busy: boolean;
  elevated: boolean;
  onUpdate: (
    update: { status: ContactRequestStatus },
    reason: string,
  ) => Promise<void>;
  status: ContactRequestStatus;
}) {
  if (status === "new") {
    return (
      <>
        <Button
          appearance="primary"
          disabled={busy}
          onClick={() => void onUpdate({ status: "in_progress" }, "Обращение принято в работу")}
        >
          Начать работу
        </Button>
        <Button
          disabled={busy}
          icon={<DismissCircle20Regular />}
          onClick={() => void onUpdate({ status: "closed" }, "Обращение закрыто сотрудником")}
        >
          Закрыть
        </Button>
      </>
    );
  }
  if (status === "in_progress") {
    return (
      <>
        <Button
          appearance="primary"
          disabled={busy}
          icon={<CheckmarkCircle20Regular />}
          onClick={() => void onUpdate({ status: "resolved" }, "Обращение решено сотрудником")}
        >
          Отметить решённым
        </Button>
        <Button
          disabled={busy}
          icon={<DismissCircle20Regular />}
          onClick={() => void onUpdate({ status: "closed" }, "Обращение закрыто сотрудником")}
        >
          Закрыть
        </Button>
      </>
    );
  }
  if (!elevated) return null;
  if (status === "resolved") {
    return (
      <>
        <Button
          disabled={busy}
          onClick={() => void onUpdate({ status: "in_progress" }, "Обращение возвращено в работу руководителем")}
        >
          Вернуть в работу
        </Button>
        <Button
          disabled={busy}
          icon={<DismissCircle20Regular />}
          onClick={() => void onUpdate({ status: "closed" }, "Решённое обращение закрыто руководителем")}
        >
          Закрыть
        </Button>
      </>
    );
  }
  return (
    <Button
      disabled={busy}
      onClick={() => void onUpdate({ status: "new" }, "Обращение открыто повторно руководителем")}
    >
      Открыть снова
    </Button>
  );
}
