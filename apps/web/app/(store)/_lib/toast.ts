/**
 * One notification system for the storefront (Claude Design canvas «совместимость и аналоги», board «Уведомления»,
 * approved by the owner 24.11.2026): four kinds, one at a time — a new one replaces the last. What happened in bold,
 * what to do next in grey, a button when there is a next step. Field errors stay at their field, never here.
 *
 * Any code calls `notify(...)`; the <Toaster/> in the store shell shows it. A notification meant for the page a
 * navigation leads to (after signing in) is kept with `notifyAfterNavigation(...)` and shown there.
 */

export type ToastKind = "success" | "info" | "warning" | "error";

export interface ToastAction {
  /** A link, or `open` — a named action the page that raised the notification handles (e.g. «chat»). */
  href?: string;
  label: string;
  open?: "chat";
}

export interface ToastInput {
  action?: ToastAction;
  kind: ToastKind;
  /** Notifications with one key are one thing: a new one replaces it, `dismissToast(key)` removes it. */
  key?: string;
  text?: string;
  title: string;
}

export interface Toast extends ToastInput {
  id: number;
  /** Milliseconds it stays; null — until closed or its cause is gone. */
  lifetime: number | null;
}

/** Success — 4 s, information — 6 s, a warning while its cause lasts, an error until closed. */
export const TOAST_LIFETIME: Readonly<Record<ToastKind, number | null>> = { error: null, info: 6_000, success: 4_000, warning: null };

export const TOAST_EVENT = "an30:toast";
export const TOAST_DISMISS_EVENT = "an30:toast-dismiss";
export const TOAST_OPEN_EVENT = "an30:toast-open";
const PENDING_KEY = "an30:toast:next";
const TITLE_MAX = 120;
const TEXT_MAX = 240;

let sequence = 0;

/** The notification as shown: trimmed, with its lifetime; null when there is nothing to say. */
export function toToast(input: ToastInput): Toast | null {
  const title = input.title.replace(/\s+/gu, " ").trim().slice(0, TITLE_MAX);
  if (!title) return null;
  const text = input.text?.replace(/\s+/gu, " ").trim().slice(0, TEXT_MAX) || undefined;
  sequence += 1;
  return {
    ...input, id: sequence, lifetime: TOAST_LIFETIME[input.kind], title,
    ...(text ? { text } : { text: undefined }),
  };
}

/** Screen readers: an error or a warning interrupts (role="alert"), the rest waits its turn (role="status"). */
export function toastRole(kind: ToastKind): "alert" | "status" {
  return kind === "error" || kind === "warning" ? "alert" : "status";
}

export function notify(input: ToastInput): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ToastInput>(TOAST_EVENT, { detail: input }));
}

export function dismissToast(key: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(TOAST_DISMISS_EVENT, { detail: key }));
}

/** Kept for the next page: «Вы вошли в кабинет» after the sign-in redirect. */
export function notifyAfterNavigation(input: ToastInput): void {
  try {
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(input));
  } catch {
    // Private mode or storage refused: the notification is only a courtesy.
  }
}

export function takePendingToast(): ToastInput | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(PENDING_KEY);
    const value = JSON.parse(raw) as Partial<ToastInput>;
    const kinds: readonly ToastKind[] = ["success", "info", "warning", "error"];
    if (typeof value.title !== "string" || !kinds.includes(value.kind as ToastKind)) return null;
    return {
      kind: value.kind as ToastKind, title: value.title,
      ...(typeof value.text === "string" ? { text: value.text } : {}),
      ...(value.action && typeof value.action.label === "string" && typeof value.action.href === "string" && value.action.href.startsWith("/")
        ? { action: { href: value.action.href, label: value.action.label } } : {}),
    };
  } catch {
    return null;
  }
}
