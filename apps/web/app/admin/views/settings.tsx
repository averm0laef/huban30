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

interface OneCSettings {
  allowedNetworks: string[];
  enabled: boolean;
  hasPassword: boolean;
  updatedAt: string | null;
  username: string | null;
}

export function SettingsView() {
  const resource = useResource(() => api<OneCSettings>("/catalog/1c/settings"), []);
  const [enabled, setEnabled] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [networks, setNetworks] = useState("");
  const [baseline, setBaseline] = useState("");
  const [busy, setBusy] = useState(false);
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
        description="Пароль хранится зашифрованно и никогда не возвращается в браузер."
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
      {success ? <MessageBar intent="success"><MessageBarBody>{success}</MessageBarBody></MessageBar> : null}
      {mutationError ? <RequestError error={mutationError} onRetry={reload} /> : null}
    </>
  );
}
