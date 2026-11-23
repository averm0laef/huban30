"use client";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function csrfToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const entry = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("an30_csrf="));
  return entry ? decodeURIComponent(entry.slice("an30_csrf=".length)) : undefined;
}

function errorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = payload.message;
    if (typeof message === "string") return message;
    if (Array.isArray(message)) return message.filter((value) => typeof value === "string").join(". ");
  }
  return status === 401 ? "Сессия истекла. Войдите снова."
    : status === 403 ? "Для этого действия недостаточно прав."
      : status === 409 ? "Данные уже изменились. Обновите список."
        : "Не удалось выполнить запрос.";
}

/** Fired when a working request is answered «not signed in»: the workspace re-checks the session itself. */
export const SESSION_LOST_EVENT = "an30:staff-session-lost";

/**
 * A 401 on a working request means the session ended (expired, signed out in another tab). The sign-in
 * requests themselves answer 401 for a wrong password or code — that is not a lost session.
 */
export function isSessionLoss(path: string, status: number): boolean {
  return status === 401 && !path.startsWith("/auth/");
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const token = csrfToken();
    if (token) headers.set("X-CSRF-Token", token);
  }
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    cache: "no-store",
    credentials: "include",
    headers,
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload: unknown = response.status === 204
    ? null
    : contentType.includes("application/json")
      ? await response.json()
      : await response.text();
  if (!response.ok) {
    if (isSessionLoss(path, response.status) && typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_LOST_EVENT));
    throw new ApiError(errorMessage(payload, response.status), response.status, payload);
  }
  return payload as T;
}

export function queryString(values: Record<string, string | number | undefined>): string {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") parameters.set(key, String(value));
  }
  const serialized = parameters.toString();
  return serialized ? `?${serialized}` : "";
}
