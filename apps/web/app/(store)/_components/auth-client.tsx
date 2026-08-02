"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { apiRequest, errorText } from "../_lib/storefront-api";
import { consumeAuthToken } from "../_lib/auth-token";
import styles from "./storefront.module.css";

export type AuthMode = "forgot" | "login" | "register" | "reset" | "staff-accept" | "verify";

interface MessageResponse {
  developmentToken?: string;
  message?: string;
}

interface LoginResponse {
  mfaRequired: boolean;
  role: "customer" | "manager" | "director" | "admin";
  totpSetupRequired: boolean;
}

const modeLabels: Array<{ label: string; mode: AuthMode }> = [
  { label: "Вход", mode: "login" },
  { label: "Регистрация", mode: "register" },
  { label: "Восстановление", mode: "forgot" },
];

function Status({ error, success }: { error: string; success: string }) {
  if (error) return <div className={styles.formError} role="alert"><strong>Не получилось</strong><p>{error}</p></div>;
  if (success) return <div className={styles.formSuccess} role="status"><strong>Готово</strong><p>{success}</p></div>;
  return null;
}

export function AuthClient({ initialMode, initialSuccess }: { initialMode: AuthMode; initialSuccess: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(initialSuccess);
  const [developmentToken, setDevelopmentToken] = useState("");
  const [token, setToken] = useState("");
  const [tokenReady, setTokenReady] = useState(false);

  useEffect(() => {
    const consumed = consumeAuthToken(window.location.href);
    window.history.replaceState(window.history.state, "", consumed.cleanUrl);
    setToken(consumed.token);
    setTokenReady(true);
  }, []);

  function resetStatus() {
    setError("");
    setSuccess("");
    setDevelopmentToken("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    resetStatus();
    setPending(true);
    const form = new FormData(element);
    try {
      if (initialMode === "login") {
        const result = await apiRequest<LoginResponse>("/auth/login", {
          method: "POST",
          body: { email: form.get("email"), password: form.get("password") },
        });
        if (result.role === "customer") {
          router.replace("/profile");
        } else {
          router.replace("/admin");
        }
        router.refresh();
        return;
      }
      if (initialMode === "register") {
        const password = String(form.get("password") ?? "");
        if (password !== form.get("passwordConfirm")) throw new Error("Пароли не совпадают");
        const result = await apiRequest<MessageResponse>("/auth/register", {
          method: "POST",
          body: { displayName: form.get("displayName"), email: form.get("email"), password },
        });
        setSuccess(result.message ?? "Проверьте почту и подтвердите регистрацию");
        setDevelopmentToken(result.developmentToken ?? "");
        element.reset();
        return;
      }
      if (initialMode === "forgot") {
        const result = await apiRequest<MessageResponse>("/auth/password/forgot", {
          method: "POST",
          body: { email: form.get("email") },
        });
        setSuccess(result.message ?? "Если аккаунт существует, инструкция отправлена на email");
        setDevelopmentToken(result.developmentToken ?? "");
        element.reset();
        return;
      }
      if (initialMode === "verify") {
        const result = await apiRequest<MessageResponse>("/auth/email/verify", {
          method: "POST",
          body: { token },
        });
        setSuccess(result.message ?? "Email подтверждён. Теперь можно войти");
        return;
      }
      if (initialMode === "staff-accept") {
        const password = String(form.get("password") ?? "");
        if (password !== form.get("passwordConfirm")) throw new Error("Пароли не совпадают");
        await apiRequest<MessageResponse>("/auth/staff/invitations/accept", {
          method: "POST",
          body: { displayName: form.get("displayName"), password, token },
        });
        element.reset();
        router.replace("/auth?mode=login&accepted=1");
        router.refresh();
        return;
      }
      const password = String(form.get("password") ?? "");
      if (password !== form.get("passwordConfirm")) throw new Error("Пароли не совпадают");
      const result = await apiRequest<MessageResponse>("/auth/password/reset", {
        method: "POST",
        body: { password, token },
      });
      setSuccess(result.message ?? "Пароль изменён. Теперь можно войти");
      element.reset();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPending(false);
    }
  }

  const tokenRequired = initialMode === "verify" || initialMode === "reset" || initialMode === "staff-accept";
  const tokenMissing = tokenRequired && token.length < 32;

  return (
    <div className={`${styles.page} ${styles.authLayout}`}>
      <section className={styles.authIntro}>
        <p className={styles.eyebrow}>Личный кабинет</p>
        <h1>{initialMode === "register" ? "Создать аккаунт" : initialMode === "forgot" ? "Вернуть доступ" : initialMode === "reset" ? "Новый пароль" : initialMode === "verify" ? "Подтвердить email" : initialMode === "staff-accept" ? "Принять приглашение" : "Войти в АН-30"}</h1>
        <p>Заказы, сохранённые товары и адреса доступны только после серверной проверки сессии.</p>
        <ul className={styles.checkList}>
          <li>Пароль хранится в виде стойкого Argon2id-хеша.</li>
          <li>Сессия находится в защищённой cookie.</li>
          <li>Сотрудники входят через отдельный контур с TOTP.</li>
        </ul>
      </section>
      <section className={styles.formPanel} aria-labelledby="auth-form-title">
        <nav className={styles.segmentedNav} aria-label="Действия с аккаунтом">
          {modeLabels.map((item) => (
            <Link key={item.mode} href={`/auth?mode=${item.mode}`} aria-current={initialMode === item.mode ? "page" : undefined}>{item.label}</Link>
          ))}
        </nav>
        <h2 id="auth-form-title" className={styles.visuallyHidden}>Форма авторизации</h2>
        <Status error={error} success={success} />
        {developmentToken ? (
          <p className={styles.devNotice}>Локальный режим почты: <Link href={`/auth?mode=${initialMode === "register" ? "verify" : "reset"}#token=${encodeURIComponent(developmentToken)}`}>открыть тестовую ссылку</Link>.</p>
        ) : null}
        {tokenRequired && !tokenReady ? (
          <div className={styles.loadingState} role="status"><strong>Проверяем одноразовую ссылку</strong></div>
        ) : tokenMissing ? (
          <div className={styles.formError} role="alert"><strong>Ссылка неполная</strong><p>В адресе нет действующего токена. Запросите новое письмо.</p></div>
        ) : (
          <form className={styles.stackForm} onSubmit={submit}>
            {initialMode === "register" || initialMode === "staff-accept" ? (
              <label className={styles.field}>Имя
                <input name="displayName" required minLength={2} maxLength={120} autoComplete="name" />
              </label>
            ) : null}
            {initialMode === "login" || initialMode === "register" || initialMode === "forgot" ? (
              <label className={styles.field}>Email
                <input name="email" type="email" required maxLength={254} autoComplete="email" inputMode="email" />
              </label>
            ) : null}
            {initialMode === "login" || initialMode === "register" || initialMode === "reset" || initialMode === "staff-accept" ? (
              <label className={styles.field}>{initialMode === "reset" ? "Новый пароль" : "Пароль"}
                <input name="password" type="password" required minLength={initialMode === "login" ? 1 : 12} maxLength={128} autoComplete={initialMode === "login" ? "current-password" : "new-password"} />
                {initialMode !== "login" ? <small>Не менее 12 символов. Не используйте email или простой словарный пароль.</small> : null}
              </label>
            ) : null}
            {initialMode === "register" || initialMode === "reset" || initialMode === "staff-accept" ? (
              <label className={styles.field}>Повторите пароль
                <input name="passwordConfirm" type="password" required minLength={12} maxLength={128} autoComplete="new-password" />
              </label>
            ) : null}
            <button className={styles.submitButton} type="submit" disabled={pending}>
              {pending ? "Отправляем..." : initialMode === "login" ? "Войти" : initialMode === "register" ? "Создать аккаунт" : initialMode === "forgot" ? "Отправить инструкцию" : initialMode === "verify" ? "Подтвердить email" : initialMode === "staff-accept" ? "Принять приглашение" : "Сохранить новый пароль"}
            </button>
          </form>
        )}
        <div className={styles.formLinks}>
          {initialMode !== "login" ? <Link href="/auth?mode=login">Вернуться ко входу</Link> : <Link href="/auth?mode=forgot">Забыли пароль?</Link>}
          <Link href="/privacy">Как мы обрабатываем данные</Link>
        </div>
      </section>
    </div>
  );
}
