"use client";

import { useEffect, useState } from "react";
import {
  Button,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Spinner,
  Switch,
  Textarea,
} from "@fluentui/react-components";
import { ArrowClockwise20Regular, Save20Regular } from "@fluentui/react-icons";

import { api } from "../api";
import { formatDate, RequestError, SectionHeader, useResource } from "../workspace-utils";
import styles from "../workspace.module.css";

interface OneCExchangeSummary {
  containsOnlyChanges: boolean;
  filename: string;
  kind: "catalog" | "offers";
  rowsRejected: number;
  rowsTouched: number;
}

interface OneCSettings {
  allowedNetworks: string[];
  enabled: boolean;
  hasPassword: boolean;
  lastExchangeAt: string | null;
  lastExchangeSummary: OneCExchangeSummary | Record<string, never>;
  updatedAt: string | null;
  username: string | null;
}

const EXCHANGE_KIND_LABELS: Record<OneCExchangeSummary["kind"], string> = {
  catalog: "Классификатор и товары (import.xml)",
  offers: "Цены и остатки (offers.xml)",
};

export function SettingsView() {
  const resource = useResource(() => api<OneCSettings>("/catalog/1c/settings"), []);
  const [enabled, setEnabled] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [networks, setNetworks] = useState("");
  const [baseline, setBaseline] = useState("");
  const [busy, setBusy] = useState(false);
  // Caddy is the only public entry point (see docs/ONE_C_INTEGRATION.md) and
  // routes /api on the same origin as this admin page, so the URL 1C needs
  // is just this page's own origin plus the exchange path -- computed on the
  // client rather than baked into the API response, since the server has no
  // reliable notion of "the URL the browser is actually on".
  const [exchangeUrl, setExchangeUrl] = useState("");
  const [mutationError, setMutationError] = useState<unknown>(null);
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!resource.data) return;
    const nextNetworks = resource.data.allowedNetworks.join("\n");
    setEnabled(resource.data.enabled);
    setUsername(resource.data.username ?? "");
    setNetworks(nextNetworks);
    setPassword("");
    setBaseline(JSON.stringify({ enabled: resource.data.enabled, networks: nextNetworks, username: resource.data.username ?? "" }));
  }, [resource.data]);

  useEffect(() => {
    setExchangeUrl(`${window.location.origin}/api/v1/integrations/1c/exchange`);
  }, []);

  const current = JSON.stringify({ enabled, networks, username });
  const dirty = current !== baseline || password.length > 0;

  useEffect(() => {
    if (!dirty) return;
    let confirmingHistory = false;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const guardNavigation = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      if (!window.confirm("Есть несохранённые изменения. Уйти со страницы без сохранения?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const guardHistory = () => {
      if (confirmingHistory) return;
      if (!window.confirm("Есть несохранённые изменения. Уйти со страницы без сохранения?")) {
        confirmingHistory = true;
        window.history.forward();
        window.setTimeout(() => { confirmingHistory = false; }, 0);
      }
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("popstate", guardHistory);
    document.addEventListener("click", guardNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("popstate", guardHistory);
      document.removeEventListener("click", guardNavigation, true);
    };
  }, [dirty]);

  function reload(): void {
    if (!dirty || window.confirm("Отменить несохранённые изменения и перечитать настройки?")) {
      resource.reload();
    }
  }

  async function save(): Promise<void> {
    setBusy(true);
    setMutationError(null);
    setSuccess("");
    try {
      const updated = await api<OneCSettings>("/catalog/1c/settings", {
        body: JSON.stringify({
          allowedNetworks: networks.split(/\s+/u).map((value) => value.trim()).filter(Boolean),
          enabled,
          ...(password ? { password } : {}),
          username: username.trim(),
        }),
        method: "PUT",
      });
      setPassword("");
      setBaseline(JSON.stringify({ enabled: updated.enabled, networks: updated.allowedNetworks.join("\n"), username: updated.username ?? "" }));
      setNetworks(updated.allowedNetworks.join("\n"));
      setUsername(updated.username ?? "");
      setEnabled(updated.enabled);
      setSuccess("Настройки 1С сохранены. Пароль больше не отображается.");
      resource.reload();
    } catch (error) {
      setMutationError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionHeader
        actions={<Button icon={<ArrowClockwise20Regular />} onClick={reload}>Перечитать</Button>}
        description="Пароль хранится в виде необратимого хеша (argon2id) и никогда не возвращается в браузер."
        eyebrow="Конфигурация"
        title="Настройки интеграций"
      />
      {resource.error ? <RequestError error={resource.error} onRetry={resource.reload} /> : null}
      {resource.loading && !resource.data ? <div className={styles.loadingPanel}><Spinner label="Загрузка настроек" /></div> : null}
      {resource.data ? (
        <form className={styles.settingsForm} onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className={styles.settingsHeading}>
            <div><h2>Подключение 1С</h2><p>Базовая HTTP-аутентификация доступна только из разрешённых CIDR-сетей и защищена лимитами.</p></div>
            <Switch checked={enabled} label={enabled ? "Включено" : "Выключено"} onChange={(_event, data) => setEnabled(data.checked)} />
          </div>
          <Field
            hint="Укажите этот адрес в 1С: Администрирование → Настройка синхронизации данных → Обмен с сайтом (CommerceML), вместе с логином и паролем ниже."
            label="Адрес обмена для 1С"
          >
            <Input readOnly value={exchangeUrl} onClick={(event) => event.currentTarget.select()} />
          </Field>
          <Field label="Имя пользователя" required>
            <Input autoComplete="off" onChange={(_event, data) => setUsername(data.value)} value={username} />
          </Field>
          <Field
            hint={resource.data.hasPassword ? "Пароль сохранён. Оставьте поле пустым, чтобы не менять его." : "Требуется не менее 16 символов."}
            label="Новый пароль"
          >
            <Input autoComplete="new-password" onChange={(_event, data) => setPassword(data.value)} type="password" value={password} />
          </Field>
          <Field hint="Одна IPv4 или IPv6 CIDR-сеть на строку." label="Разрешённые сети" required>
            <Textarea onChange={(_event, data) => setNetworks(data.value)} resize="vertical" rows={5} value={networks} />
          </Field>
          <div className={styles.formFooter}>
            <span>{dirty ? "Есть несохранённые изменения" : `Сохранено ${formatDate(resource.data.updatedAt)}`}</span>
            <Button appearance="primary" disabled={!dirty || busy} icon={<Save20Regular />} type="submit">Сохранить</Button>
          </div>
        </form>
      ) : null}
      {resource.data ? <LastExchangeResult summary={resource.data.lastExchangeSummary} timestamp={resource.data.lastExchangeAt} /> : null}
      {success ? <MessageBar intent="success"><MessageBarBody>{success}</MessageBarBody></MessageBar> : null}
      {mutationError ? <RequestError error={mutationError} onRetry={reload} /> : null}
    </>
  );
}

// "kind" in lastExchangeSummary is enough to tell an empty summary ({}, the
// database default before any run has ever completed) apart from a real one
// -- narrower than checking Object.keys().length, and it doubles as the type
// guard the rest of the component needs.
function LastExchangeResult({
  summary,
  timestamp,
}: {
  summary: OneCExchangeSummary | Record<string, never>;
  timestamp: string | null;
}) {
  return (
    <section aria-labelledby="one-c-exchange-result-title" className={styles.settingsForm}>
      <div className={styles.settingsHeading}>
        <div>
          <h2 id="one-c-exchange-result-title">Последний обмен CommerceML</h2>
          <p>Результат самого недавнего завершённого запроса 1С к адресу обмена выше.</p>
        </div>
      </div>
      {!("kind" in summary) || !timestamp ? (
        <p className={styles.muted}>Обмена с 1С через этот адрес ещё не было.</p>
      ) : (
        <dl className={styles.detailList}>
          <div><dt>Файл</dt><dd>{EXCHANGE_KIND_LABELS[summary.kind]} — {summary.filename}</dd></div>
          <div><dt>Тип выгрузки</dt><dd>{summary.containsOnlyChanges ? "Только изменения" : "Полная выгрузка"}</dd></div>
          <div><dt>Применено строк</dt><dd>{summary.rowsTouched}</dd></div>
          <div><dt>Отклонено строк</dt><dd>{summary.rowsRejected}</dd></div>
          <div><dt>Завершён</dt><dd>{formatDate(timestamp)}</dd></div>
        </dl>
      )}
    </section>
  );
}
