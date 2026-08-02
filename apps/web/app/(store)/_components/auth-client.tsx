"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { apiRequest, errorText, StorefrontApiError } from "../_lib/storefront-api";
import { consumeAuthToken } from "../_lib/auth-token";
import styles from "./storefront.module.css";
import authStyles from "../auth/auth-flow.module.css";

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

const modeTitles: Record<AuthMode, string> = {
  forgot: "Вернуть доступ",
  login: "Войти в АН-30",
  register: "Создать аккаунт",
  reset: "Новый пароль",
  "staff-accept": "Принять приглашение",
  verify: "Подтвердить email",
};

const submitLabels: Record<AuthMode, { pending: string; ready: string }> = {
  forgot: { pending: "Отправляем…", ready: "Отправить инструкцию" },
  login: { pending: "Проверяем…", ready: "Войти" },
  register: { pending: "Создаём…", ready: "Создать аккаунт" },
  reset: { pending: "Сохраняем…", ready: "Сохранить новый пароль" },
  "staff-accept": { pending: "Принимаем…", ready: "Принять приглашение" },
  verify: { pending: "Подтверждаем…", ready: "Подтвердить email" },
};

type StatusKind = "error" | "success" | "warning";
type StatusState = { kind: StatusKind; message: string; title: string } | null;

function StatusBanner({ status }: { status: StatusState }) {
  if (!status) return null;
  if (status.kind === "warning") {
    return (
      <div className={authStyles.formWarning} role="alert">
        <strong>{status.title}</strong>
        <p>{status.message}</p>
      </div>
    );
  }
  const className = status.kind === "error" ? styles.formError : styles.formSuccess;
  const role = status.kind === "error" ? "alert" : "status";
  return (
    <div className={className} role={role}>
      <strong>{status.title}</strong>
      <p>{status.message}</p>
    </div>
  );
}

/**
 * The API deliberately returns one generic "Неверный email или пароль" for
 * every login failure — wrong password, unverified email, a locked account
 * or an unknown address all look the same on the wire so a caller cannot
 * enumerate account state. We keep that contract intact and only add a
 * clearer heading; the server's own wording is always shown as-is beneath it.
 * Rate limiting (429) is a different, safely-disclosable signal — it says
 * nothing about whether the account exists — so it gets its own distinct,
 * non-error styling.
 */
function describeFailure(mode: AuthMode, error: unknown): { kind: "error" | "warning"; message: string; title: string } {
  if (error instanceof StorefrontApiError) {
    if (error.status === 429) {
      return { kind: "warning", message: error.message, title: "Слишком много попыток" };
    }
    if (error.status === 0) {
      return { kind: "error", message: error.message, title: "Нет соединения" };
    }
    if (mode === "login" && error.status === 401) {
      return { kind: "error", message: error.message, title: "Не получилось войти" };
    }
  }
  return { kind: "error", message: errorText(error), title: "Не получилось" };
}

export function AuthClient({ initialMode, initialSuccess }: { initialMode: AuthMode; initialSuccess: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<StatusState>(
    initialSuccess ? { kind: "success", message: initialSuccess, title: "Готово" } : null,
  );
  const [developmentToken, setDevelopmentToken] = useState("");
  const [token, setToken] = useState("");
  const [tokenReady, setTokenReady] = useState(false);
  const [passwordMismatch, setPasswordMismatch] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const passwordConfirmRef = useRef<HTMLInputElement>(null);
  const mountedMode = useRef(initialMode);

  useEffect(() => {
    const consumed = consumeAuthToken(window.location.href);
    window.history.replaceState(window.history.state, "", consumed.cleanUrl);
    setToken(consumed.token);
    setTokenReady(true);
  }, []);

  // Switching tabs (вход / регистрация / восстановление) must not leave a
  // stale error or success banner from the previous form on screen.
  useEffect(() => {
    if (mountedMode.current === initialMode) return;
    mountedMode.current = initialMode;
    setStatus(null);
    setDevelopmentToken("");
    setPasswordMismatch(false);
  }, [initialMode]);

  function resetStatus() {
    setStatus(null);
    setDevelopmentToken("");
  }

  function checkPasswordMatch() {
    if (!passwordRef.current || !passwordConfirmRef.current) return;
    const confirmValue = passwordConfirmRef.current.value;
    setPasswordMismatch(confirmValue.length > 0 && confirmValue !== passwordRef.current.value);
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
          // Staff always land on /admin next; that screen itself shows the
          // TOTP setup/verification step before revealing any staff data.
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
        setStatus({
          kind: "success",
          message: result.message ?? "Проверьте почту и подтвердите регистрацию",
          title: "Письмо отправлено",
        });
        setDevelopmentToken(result.developmentToken ?? "");
        element.reset();
        setPasswordMismatch(false);
        return;
      }
      if (initialMode === "forgot") {
        const result = await apiRequest<MessageResponse>("/auth/password/forgot", {
          method: "POST",
          body: { email: form.get("email") },
        });
        setStatus({
          kind: "success",
          message: result.message ?? "Если аккаунт существует, инструкция отправлена на email",
          title: "Письмо отправлено",
        });
        setDevelopmentToken(result.developmentToken ?? "");
        element.reset();
        return;
      }
      if (initialMode === "verify") {
        const result = await apiRequest<MessageResponse>("/auth/email/verify", {
          method: "POST",
          body: { token },
        });
        setStatus({
          kind: "success",
          message: result.message ?? "Email подтверждён. Теперь можно войти",
          title: "Email подтверждён",
        });
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
      setStatus({
        kind: "success",
        message: result.message ?? "Пароль изменён. Теперь можно войти",
        title: "Пароль изменён",
      });
      element.reset();
      setPasswordMismatch(false);
    } catch (caught) {
      setStatus(describeFailure(initialMode, caught));
    } finally {
      setPending(false);
    }
  }

  const tokenRequired = initialMode === "verify" || initialMode === "reset" || initialMode === "staff-accept";
  const tokenMissing = tokenRequired && token.length < 32;
  const showPasswordConfirm = initialMode === "register" || initialMode === "reset" || initialMode === "staff-accept";
  const registerSucceeded = initialMode === "register" && status?.kind === "success";
  const verifySucceeded = initialMode === "verify" && status?.kind === "success";
  const resetSucceeded = initialMode === "reset" && status?.kind === "success";

  return (
    <div className={`${styles.page} ${styles.authLayout}`}>
      <section className={styles.authIntro}>
        <p className={styles.eyebrow}>Личный кабинет</p>
        <h1>{modeTitles[initialMode]}</h1>
        <p>Заказы, сохранённые товары и адреса доступны только после серверной проверки сессии.</p>
        <ul className={styles.checkList}>
          <li>Пароль хранится в виде стойкого Argon2id-хеша.</li>
          <li>Сессия находится в защищённой cookie, а не в localStorage.</li>
          <li>Новый аккаунт нужно подтвердить по ссылке из письма — без этого войти нельзя.</li>
          <li>Сотрудники после пароля проходят ещё один шаг — одноразовый код TOTP.</li>
        </ul>
      </section>
      <section className={styles.formPanel} aria-labelledby="auth-form-title">
        <nav className={styles.segmentedNav} aria-label="Действия с аккаунтом">
          {modeLabels.map((item) => (
            <Link key={item.mode} href={`/auth?mode=${item.mode}`} aria-current={initialMode === item.mode ? "page" : undefined}>{item.label}</Link>
          ))}
        </nav>
        <h2 id="auth-form-title" className={styles.visuallyHidden}>Форма авторизации</h2>
        <StatusBanner status={status} />
        {developmentToken ? (
          <p className={styles.devNotice}>Локальный режим почты: <Link href={`/auth?mode=${initialMode === "register" ? "verify" : "reset"}#token=${encodeURIComponent(developmentToken)}`}>открыть тестовую ссылку</Link>.</p>
        ) : null}
        {registerSucceeded ? (
          <p className={authStyles.fieldHint}>
            Не пришло письмо за несколько минут? Проверьте папку «Спам» или заполните форму регистрации ещё раз — мы вышлем новую ссылку.
          </p>
        ) : null}
        {(verifySucceeded || resetSucceeded) ? (
          <div className={authStyles.successActions}>
            <Link className={styles.primaryAction} href="/auth?mode=login">Войти</Link>
          </div>
        ) : null}
        {tokenRequired && !tokenReady ? (
          <div className={styles.loadingState} role="status"><strong>Проверяем одноразовую ссылку</strong></div>
        ) : tokenMissing ? (
          <div className={styles.formError} role="alert">
            <strong>Ссылка неполная</strong>
            <p>
              В адресе нет действующего токена — возможно, ссылка была скопирована не полностью или уже устарела.{" "}
              {initialMode === "verify" ? (
                <>Зарегистрируйтесь ещё раз на <Link href="/auth?mode=register">странице регистрации</Link>, чтобы получить новое письмо.</>
              ) : initialMode === "reset" ? (
                <>Запросите новую ссылку через <Link href="/auth?mode=forgot">восстановление пароля</Link>.</>
              ) : (
                <>Приглашения выдаёт администратор — попросите его отправить новое приглашение.</>
              )}
            </p>
          </div>
        ) : (verifySucceeded || resetSucceeded) ? null : (
          <form className={styles.stackForm} onSubmit={submit}>
            {initialMode === "register" || initialMode === "staff-accept" ? (
              <label className={styles.field}>Имя
                <input name="displayName" required minLength={2} maxLength={120} autoComplete="name" />
              </label>
            ) : null}
            {initialMode === "login" || initialMode === "register" || initialMode === "forgot" ? (
              <label className={styles.field}>Email
                <input name="email" type="email" required maxLength={254} autoComplete="email" inputMode="email" />
                {initialMode === "register" ? (
                  <small>После регистрации на этот адрес придёт письмо со ссылкой подтверждения.</small>
                ) : null}
              </label>
            ) : null}
            {initialMode === "login" || initialMode === "register" || initialMode === "reset" || initialMode === "staff-accept" ? (
              <label className={styles.field}>{initialMode === "reset" ? "Новый пароль" : "Пароль"}
                <input
                  ref={initialMode === "login" ? undefined : passwordRef}
                  name="password"
                  type="password"
                  required
                  minLength={initialMode === "login" ? 1 : 12}
                  maxLength={128}
                  autoComplete={initialMode === "login" ? "current-password" : "new-password"}
                  onInput={showPasswordConfirm ? checkPasswordMatch : undefined}
                  aria-describedby={initialMode === "login" ? undefined : "auth-password-hint"}
                />
                {initialMode !== "login" ? <small id="auth-password-hint">Не менее 12 символов. Не используйте email или простой словарный пароль.</small> : null}
              </label>
            ) : null}
            {showPasswordConfirm ? (
              <label className={styles.field}>Повторите пароль
                <input
                  ref={passwordConfirmRef}
                  name="passwordConfirm"
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  onInput={checkPasswordMatch}
                  aria-invalid={passwordMismatch}
                  aria-describedby={passwordMismatch ? "auth-password-mismatch" : undefined}
                />
                {passwordMismatch ? (
                  <small id="auth-password-mismatch" className={authStyles.fieldError} role="alert">Пароли не совпадают</small>
                ) : null}
              </label>
            ) : null}
            <button className={styles.submitButton} type="submit" disabled={pending || (showPasswordConfirm && passwordMismatch)}>
              {pending ? submitLabels[initialMode].pending : submitLabels[initialMode].ready}
            </button>
          </form>
        )}
        {initialMode === "login" ? (
          <details className={authStyles.helpDetails}>
            <summary>Не получается войти?</summary>
            <ul>
              <li>Проверьте email и пароль без опечаток — форма не подсказывает, какое поле неверно.</li>
              <li>Только что зарегистрировались? Сначала подтвердите email по ссылке из письма — иначе вход будет отклонён.</li>
              <li>После 5 неверных попыток подряд вход блокируется на 15 минут — это защита от подбора пароля, а не сбой.</li>
              <li>Забыли пароль — воспользуйтесь восстановлением по ссылке ниже.</li>
            </ul>
          </details>
        ) : null}
        <div className={styles.formLinks}>
          {initialMode !== "login" ? <Link href="/auth?mode=login">Вернуться ко входу</Link> : <Link href="/auth?mode=forgot">Забыли пароль?</Link>}
          <Link href="/privacy">Как мы обрабатываем данные</Link>
        </div>
      </section>
    </div>
  );
}
