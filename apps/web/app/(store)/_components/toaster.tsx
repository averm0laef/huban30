"use client";

import { Checkmark16Filled, Dismiss16Regular, ErrorCircle16Filled, Info16Filled, Warning16Filled } from "@fluentui/react-icons";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  takePendingToast, toastRole, toToast, TOAST_DISMISS_EVENT, TOAST_EVENT, TOAST_OPEN_EVENT, type Toast, type ToastInput, type ToastKind,
} from "../_lib/toast";
import styles from "./toaster.module.css";

const ICONS: Record<ToastKind, typeof Checkmark16Filled> = {
  error: ErrorCircle16Filled, info: Info16Filled, success: Checkmark16Filled, warning: Warning16Filled,
};

/**
 * The storefront's notification layer (board «Уведомления»): one at a time, top right on a computer, above the
 * bottom menu on a phone. It stops counting while the pointer or focus is on it, so a slow reader never loses it;
 * «Нет связи» shows while the browser is offline and goes when it is back.
 */
export function Toaster() {
  const pathname = usePathname();
  const [toast, setToast] = useState<Toast | null>(null);
  const [paused, setPaused] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  // Time left for the notification on screen, tied to it: a new notification never inherits the last one's clock.
  const left = useRef<{ id: number; ms: number | null }>({ id: 0, ms: null });

  const show = useCallback((input: ToastInput) => {
    const next = toToast(input);
    if (!next) return;
    left.current = { id: next.id, ms: next.lifetime };
    setToast(next);
  }, []);

  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    setToast(null);
  }, []);

  useEffect(() => {
    const onShow = (event: Event) => show((event as CustomEvent<ToastInput>).detail);
    const onDismiss = (event: Event) => {
      const key = (event as CustomEvent<string>).detail;
      setToast((current) => (current?.key === key ? null : current));
    };
    const offline = () => show({ key: "offline", kind: "warning", text: "Отправим, когда появится интернет.", title: "Нет связи" });
    const online = () => setToast((current) => (current?.key === "offline" ? null : current));
    window.addEventListener(TOAST_EVENT, onShow);
    window.addEventListener(TOAST_DISMISS_EVENT, onDismiss);
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener(TOAST_EVENT, onShow);
      window.removeEventListener(TOAST_DISMISS_EVENT, onDismiss);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, [show]);

  // A notification left for this page by the one before it (signing in, signing out).
  useEffect(() => {
    const pending = takePendingToast();
    if (pending) show(pending);
  }, [pathname, show]);

  // Counting down, paused while hovered or focused.
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!toast || left.current.id !== toast.id || left.current.ms === null || paused) return undefined;
    const id = toast.id;
    const startedAt = Date.now();
    timer.current = window.setTimeout(() => setToast((current) => (current?.id === id ? null : current)), left.current.ms);
    return () => {
      window.clearTimeout(timer.current);
      if (left.current.id === id && left.current.ms !== null) left.current = { id, ms: Math.max(1_500, left.current.ms - (Date.now() - startedAt)) };
    };
  }, [toast, paused]);

  if (!toast) return null;
  const Icon = ICONS[toast.kind];
  const action = toast.action;
  return (
    <div className={styles.region}>
      <div
        className={styles.toast}
        data-kind={toast.kind}
        key={toast.id}
        onBlur={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        role={toastRole(toast.kind)}
      >
        <span aria-hidden="true" className={styles.icon}><Icon /></span>
        <div className={styles.body}>
          <p className={styles.title}>{toast.title}</p>
          {toast.text ? <p className={styles.text}>{toast.text}</p> : null}
          {action ? (
            action.href
              ? <Link className={styles.action} href={action.href} onClick={close}>{action.label}</Link>
              : <button className={styles.action} onClick={() => { if (action.open) window.dispatchEvent(new CustomEvent(TOAST_OPEN_EVENT, { detail: action.open })); close(); }} type="button">{action.label}</button>
          ) : null}
        </div>
        <button aria-label="Закрыть уведомление" className={styles.close} onClick={close} type="button"><Dismiss16Regular aria-hidden="true" /></button>
        {toast.lifetime !== null ? <span aria-hidden="true" className={styles.timer} data-paused={paused || undefined} style={{ animationDuration: `${toast.lifetime}ms` }} /> : null}
      </div>
    </div>
  );
}
