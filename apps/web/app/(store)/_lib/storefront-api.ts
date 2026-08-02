export const API_PREFIX = "/api/v1";

type ApiRequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

export class StorefrontApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(message);
    this.name = "StorefrontApiError";
  }
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${encodeURIComponent(name)}=`;
  for (const segment of document.cookie.split(";")) {
    const value = segment.trim();
    if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length));
  }
  return null;
}

function issueMessage(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("message" in value)) return null;
  const message = value.message;
  return typeof message === "string" && message.trim() ? message : null;
}

export function apiErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) return record.message;
    if (Array.isArray(record.message)) {
      const messages = record.message.filter((item): item is string => typeof item === "string");
      if (messages.length) return messages.join(". ");
    }
    if (record.message && typeof record.message === "object") {
      const nested = record.message as Record<string, unknown>;
      if (Array.isArray(nested.issues)) {
        const messages = nested.issues.map(issueMessage).filter((item): item is string => Boolean(item));
        if (messages.length) return messages.join(". ");
      }
      if (typeof nested.error === "string" && nested.error.trim()) return nested.error;
    }
    if (Array.isArray(record.issues)) {
      const messages = record.issues.map(issueMessage).filter((item): item is string => Boolean(item));
      if (messages.length) return messages.join(". ");
    }
    if (typeof record.error === "string" && record.error.trim()) return record.error;
  }
  if (status === 401) return "Сессия завершена. Войдите снова";
  if (status === 403) return "Недостаточно прав для этого действия";
  if (status === 404) return "Запрошенные данные не найдены";
  if (status === 409) return "Данные изменились. Обновите страницу и повторите действие";
  if (status === 429) return "Слишком много запросов. Попробуйте позже";
  if (status >= 500) return "Сервис временно недоступен";
  return "Не удалось выполнить запрос";
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (!new Set(["GET", "HEAD", "OPTIONS"]).has(method)) {
    const csrf = readCookie("an30_csrf");
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }

  let response: Response;
  try {
    response = await fetch(path.startsWith(API_PREFIX) ? path : `${API_PREFIX}${path}`, {
      ...options,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      credentials: "include",
      headers,
      method,
    });
  } catch {
    throw new StorefrontApiError("Нет соединения с сервером", 0, null);
  }

  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") ?? "";
  let payload: unknown;
  if (contentType.includes("application/json")) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  } else {
    const text = await response.text();
    payload = text || null;
  }
  if (!response.ok) throw new StorefrontApiError(apiErrorMessage(payload, response.status), response.status, payload);
  return payload as T;
}

export interface SessionView {
  email: string;
  mfaSetupRequired: boolean;
  mfaVerified: boolean;
  role: "customer" | "manager" | "director" | "admin";
  userId: string;
}

export async function readSession(): Promise<SessionView | null> {
  try {
    return await apiRequest<SessionView>("/auth/session");
  } catch (error) {
    if (error instanceof StorefrontApiError && error.status === 401) return null;
    throw error;
  }
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Неизвестная ошибка";
}
