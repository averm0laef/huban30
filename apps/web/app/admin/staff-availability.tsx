"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Switch } from "@fluentui/react-components";
import { api } from "./api";
import styles from "./staff-availability.module.css";

export const availabilityPreferenceKey = (userId: string) => `an30_staff_receiving_${userId}`;

/** Explicit operator opt-in, renewed only by a visible authenticated tab. */
export function StaffAvailability({ userId }: { userId: string }) {
  const key = availabilityPreferenceKey(userId);
  const [enabled, setEnabled] = useState(() => {
    try { return typeof window !== "undefined" && window.localStorage.getItem(key) === "true"; } catch { return false; }
  });
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<Promise<unknown>>(Promise.resolve());
  const sendStatus = useCallback((available: boolean) => {
    // Serialise this tab's requests: a slow heartbeat must not re-enable
    // availability after the operator switched it off.
    const operation = pending.current.catch(() => undefined).then(() => api("/staff/availability", {
      method: "POST", body: JSON.stringify({ available }), signal: AbortSignal.timeout(8_000),
    }));
    pending.current = operation;
    return operation;
  }, []);

  useEffect(() => {
    function synchronize(event: StorageEvent) {
      if (event.key !== key) return;
      const next = event.newValue === "true";
      setEnabled(next);
      if (!next) { setActive(false); void sendStatus(false).catch(() => setError("Статус не подтверждён. Повторим после восстановления связи.")); }
    }
    window.addEventListener("storage", synchronize);
    return () => window.removeEventListener("storage", synchronize);
  }, [key, sendStatus]);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    let running = false;
    let timer: ReturnType<typeof setTimeout>;
    async function heartbeat() {
      if (!current || running) return;
      clearTimeout(timer);
      if (document.visibilityState !== "visible" || !navigator.onLine) {
        setActive(false); timer = setTimeout(() => void heartbeat(), 15_000); return;
      }
      running = true;
      try { await sendStatus(true); if (current) { setActive(true); setError(""); } }
      catch { if (current) { setActive(false); setError("Не удалось подтвердить готовность. Проверьте соединение."); } }
      finally { running = false; if (current) timer = setTimeout(() => void heartbeat(), 15_000); }
    }
    const renew = () => { if (document.visibilityState === "visible") void heartbeat(); else setActive(false); };
    document.addEventListener("visibilitychange", renew);
    window.addEventListener("focus", renew);
    window.addEventListener("online", renew);
    void heartbeat();
    return () => { current = false; clearTimeout(timer); document.removeEventListener("visibilitychange", renew); window.removeEventListener("focus", renew); window.removeEventListener("online", renew); };
  }, [enabled, sendStatus]);

  function toggle(next: boolean) {
    setEnabled(next); setError("");
    try { window.localStorage.setItem(key, String(next)); } catch { /* The current tab still works without persistent preferences. */ }
    if (!next) {
      setActive(false);
      void sendStatus(false).catch(() => setError("Отключение пока не подтверждено. Готовность автоматически истечёт менее чем через минуту."));
    }
  }
  return <div className={styles.availability} data-active={active || undefined} title={error || "Включите готовность: новые обращения будут назначаться автоматически. Готовность подтверждается, пока эта вкладка открыта на экране."}>
    <Switch checked={enabled} label="Принимать обращения" onChange={(_, data) => toggle(data.checked)} />
    <span className={styles.state} role="status">{error ? "Нет подтверждения" : enabled ? active ? "Готов к диалогам" : "Подтверждаем готовность…" : "На паузе"}</span>
    {error && <span className={styles.error} role="alert">{error}</span>}
  </div>;
}
