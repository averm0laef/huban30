"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { apiRequest, errorText } from "../_lib/storefront-api";
import styles from "../auth/auth-flow.module.css";

const names = { yandex: "Яндекс ID", vk: "VK ID" } as const;
const origins = { yandex: "https://oauth.yandex.ru", vk: "https://id.vk.ru" } as const;
type Provider = keyof typeof names;

interface Connections {
  enabled: Provider[];
  linked: Provider[];
}

async function redirectToProvider(provider: Provider, action: "login" | "link", body?: unknown) {
  const { authorizationUrl } = await apiRequest<{ authorizationUrl: string }>(`/auth/social/${provider}/${action}`, {
    body,
    method: "POST",
  });
  const url = new URL(authorizationUrl);
  if (url.origin !== origins[provider] || url.pathname !== "/authorize" || url.username || url.password) {
    throw new Error("Не удалось открыть страницу входа");
  }
  window.location.assign(url);
}

export function SocialLogin({ status }: { status?: string }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [pending, setPending] = useState<Provider | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<Pick<Connections, "enabled">>("/auth/social/providers", { signal: controller.signal })
      .then(value => setProviders(value.enabled))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  async function login(provider: Provider) {
    setPending(provider);
    setError("");
    try {
      await redirectToProvider(provider, "login");
    } catch (failure) {
      setError(errorText(failure));
      setPending(null);
    }
  }

  const statusMessage = status === "unlinked" ? "Этот ID ещё не привязан к аккаунту АН‑30. Войдите по почте и подключите его в разделе «Безопасность»."
    : status === "cancelled" ? "Вход через внешний сервис отменён."
    : status === "failed" ? "Не удалось завершить вход. Попробуйте снова или войдите по почте."
    : "";
  if (!providers.length && !statusMessage) return null;

  return (
    <section className={styles.socialPanel} aria-labelledby="social-login-title">
      <h2 id="social-login-title">Войти с помощью</h2>
      {providers.length ? (
        <div className={styles.providerButtons}>
          {providers.map(provider => (
            <button type="button" key={provider} disabled={pending !== null} onClick={() => void login(provider)}>
              {pending === provider ? "Открываем…" : names[provider]}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p className={styles.providerError} role="alert">{error}</p> : null}
      {statusMessage ? <p className={styles.providerMessage} role="status">{statusMessage}</p> : null}
    </section>
  );
}

export function SocialConnections({ status }: { status?: string }) {
  const [connections, setConnections] = useState<Connections | null>(null);
  const [selected, setSelected] = useState<Provider | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(status === "linked" ? "Способ входа подключён." : "");
  const passwordRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<Connections>("/auth/social/connections", { signal: controller.signal })
      .then(setConnections)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (selected) passwordRef.current?.focus();
  }, [selected]);

  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !connections || pending) return;
    const password = new FormData(event.currentTarget).get("currentPassword");
    if (typeof password !== "string") return;
    setPending(true);
    setError("");
    setNotice("");
    const body = { currentPassword: password };
    try {
      if (!connections.linked.includes(selected)) {
        await redirectToProvider(selected, "link", body);
        return;
      }
      await apiRequest(`/auth/social/${selected}/link`, { body, method: "DELETE" });
      setConnections({ ...connections, linked: connections.linked.filter(provider => provider !== selected) });
      setSelected(null);
      setNotice("Способ входа отключён.");
    } catch (failure) {
      setError(errorText(failure));
    }
    setPending(false);
  }

  const providers = connections ? Object.keys(names).filter((key): key is Provider => {
    const provider = key as Provider;
    return connections.enabled.includes(provider) || connections.linked.includes(provider);
  }) : [];
  if (!providers.length && !status) return null;
  const disconnecting = selected ? connections?.linked.includes(selected) : false;

  return (
    <section className={styles.connections} aria-labelledby="connections-title">
      <h2 id="connections-title">Способы входа</h2>
      <p>Подключите внешний ID, чтобы входить в этот же аккаунт.</p>
      {notice ? <p className={styles.providerMessage} role="status">{notice}</p> : null}
      {status === "link-conflict" ? <p className={styles.providerMessage} role="status">Этот способ входа уже связан с аккаунтом. Если нужно заменить ID, сначала отключите текущую привязку.</p> : null}
      {status === "link-failed" ? <p className={styles.providerMessage} role="status">Подключение не завершилось. Попробуйте ещё раз.</p> : null}
      <ul>
        {providers.map(provider => {
          const linked = connections?.linked.includes(provider);
          return (
            <li key={provider}>
              <span><strong>{names[provider]}</strong>{linked ? <small>Подключён</small> : null}</span>
              <button type="button" disabled={pending} aria-expanded={selected === provider}
                aria-label={`${linked ? "Отключить" : "Подключить"} ${names[provider]}`}
                aria-controls={selected === provider ? formId : undefined}
                onClick={() => { setSelected(selected === provider ? null : provider); setError(""); }}>
                {linked ? "Отключить" : "Подключить"}
              </button>
            </li>
          );
        })}
      </ul>
      {selected ? (
        <form className={styles.connectionForm} id={formId} key={selected} onSubmit={update} aria-busy={pending}
          aria-label={`${disconnecting ? "Отключение" : "Подключение"} ${names[selected]}`}>
          <div className={styles.formField}>
            <label htmlFor={`${formId}-password`}>Текущий пароль</label>
            <input id={`${formId}-password`} ref={passwordRef} name="currentPassword"
              type="password" autoComplete="current-password" required maxLength={128} />
          </div>
          {!disconnecting ? <p className={styles.fieldHint}>Будет сохранена связь с вашим аккаунтом у выбранного сервиса. <Link href="/privacy">Политика конфиденциальности</Link>.</p> : null}
          {error ? <p className={styles.providerError} role="alert">{error}</p> : null}
          <button type="submit" disabled={pending}>{pending ? "Подождите…" : disconnecting ? "Подтвердить отключение" : `Продолжить в ${names[selected]}`}</button>
        </form>
      ) : null}
    </section>
  );
}
