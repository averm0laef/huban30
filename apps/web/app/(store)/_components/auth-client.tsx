"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { REGISTRATION_PERSONAL_DATA_CONSENT_VERSION } from "@an30/contracts";

import authStyles from "../auth/auth-flow.module.css";
import { consumeAuthToken } from "../_lib/auth-token";
import { apiRequest, errorText, StorefrontApiError } from "../_lib/storefront-api";
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

interface ModeContext {
  benefits: Array<{ body: string; title: string }>;
  description: string;
  heading: string;
}

const primaryModes = new Set<AuthMode>(["forgot", "login", "register"]);

const modeLabels: Array<{ label: string; mode: AuthMode }> = [
  { label: "Вход", mode: "login" },
  { label: "Регистрация", mode: "register" },
  { label: "Восстановить", mode: "forgot" },
];

const modeTitles: Record<AuthMode, string> = {
  forgot: "Восстановление доступа",
  login: "Вход в аккаунт",
  register: "Регистрация",
  reset: "Новый пароль",
  "staff-accept": "Приглашение сотрудника",
  verify: "Подтверждение email",
};

const modeDescriptions: Record<AuthMode, string> = {
  forgot: "Укажите email аккаунта. Мы отправим ссылку для смены пароля, если адрес зарегистрирован.",
  login: "Введите email и пароль, которые использовали при регистрации.",
  register: "Заполните форму и подтвердите email по ссылке из письма.",
  reset: "Придумайте новую парольную фразу для аккаунта.",
  "staff-accept": "Укажите имя и задайте пароль, чтобы завершить приглашение.",
  verify: "Подтвердите адрес, чтобы активировать аккаунт и войти.",
};

const modeContext: Record<AuthMode, ModeContext> = {
  forgot: {
    heading: "Доступ можно вернуть",
    description: "Смена пароля не затронет заказы и сохранённые товары.",
    benefits: [
      { title: "Без подсказок посторонним", body: "Ответ формы не сообщает, зарегистрирован ли указанный email." },
      { title: "Одноразовая ссылка", body: "После использования или окончания срока действия ссылка перестаёт работать." },
      { title: "Сеансы будут закрыты", body: "После смены пароля потребуется войти заново на каждом устройстве." },
    ],
  },
  login: {
    heading: "Вернитесь к своим заказам",
    description: "В аккаунте собраны покупки, избранные товары и адреса доставки.",
    benefits: [
      { title: "Статусы заказов", body: "Проверяйте, что уже готово к выдаче и что ещё обрабатывается." },
      { title: "Сохранённые товары", body: "Не ищите повторно детали, которые отложили раньше." },
      { title: "Меньше повторного ввода", body: "Форма заказа подставит имя, email и телефон из профиля." },
    ],
  },
  register: {
    heading: "Заказы и детали под рукой",
    description: "Создайте аккаунт, чтобы история покупок и нужные детали оставались под рукой.",
    benefits: [
      { title: "Заказы в одном месте", body: "Смотрите состав, сумму и актуальный статус каждой покупки." },
      { title: "Избранное не потеряется", body: "Сохраняйте найденные детали и возвращайтесь к ним позже." },
      { title: "Удобнее оформлять", body: "После входа форма заказа подставит имя, email и телефон из профиля." },
    ],
  },
  reset: {
    heading: "Задайте новый пароль",
    description: "Используйте отдельную парольную фразу, которой нет на других сайтах.",
    benefits: [
      { title: "Не менее 12 символов", body: "Несколько несвязанных слов обычно легче запомнить, чем короткий сложный пароль." },
      { title: "Не повторяйте email", body: "Имя почтового ящика не должно быть частью пароля." },
      { title: "Вход заново", body: "После смены пароля активные сеансы аккаунта будут закрыты." },
    ],
  },
  "staff-accept": {
    heading: "Завершите приглашение",
    description: "После установки пароля система попросит настроить одноразовые коды для входа.",
    benefits: [
      { title: "Персональный доступ", body: "Не передавайте пароль или приглашение другому сотруднику." },
      { title: "Дополнительная проверка", body: "При первом входе потребуется настроить TOTP в приложении-аутентификаторе." },
      { title: "Резервные коды", body: "После настройки сохраните их отдельно от рабочего устройства." },
    ],
  },
  verify: {
    heading: "Подтвердите ваш email",
    description: "Это связывает аккаунт с адресом, к которому у вас есть доступ.",
    benefits: [
      { title: "Активация аккаунта", body: "До подтверждения email вход в новый аккаунт закрыт." },
      { title: "Одно нажатие", body: "Кнопка в форме завершит проверку открытой ссылки." },
      { title: "После подтверждения", body: "Вернитесь ко входу и продолжайте работу с заказами." },
    ],
  },
};

const submitLabels: Record<AuthMode, { pending: string; ready: string }> = {
  forgot: { pending: "Отправляем...", ready: "Отправить ссылку" },
  login: { pending: "Проверяем...", ready: "Войти" },
  register: { pending: "Создаём...", ready: "Создать аккаунт" },
  reset: { pending: "Сохраняем...", ready: "Сохранить пароль" },
  "staff-accept": { pending: "Принимаем...", ready: "Принять приглашение" },
  verify: { pending: "Подтверждаем...", ready: "Подтвердить email" },
};

type StatusKind = "error" | "success" | "warning";
type StatusState = { kind: StatusKind; message: string; title: string } | null;

function StatusBanner({ status }: { status: StatusState }) {
  if (!status) return null;
  const stateClass = status.kind === "warning"
    ? authStyles.formWarning
    : status.kind === "error"
      ? styles.formError
      : styles.formSuccess;
  const role = status.kind === "error" || status.kind === "warning" ? "alert" : "status";
  return (
    <div className={`${stateClass} ${authStyles.statusBanner}`} role={role}>
      <strong>{status.title}</strong>
      <p>{status.message}</p>
    </div>
  );
}

/**
 * The server deliberately returns the same login error for an unknown email,
 * an invalid password, an unverified account and a locked account. Keep that
 * privacy boundary intact while giving connection and rate-limit failures a
 * useful heading.
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

function passwordGuidance(length: number): string {
  if (length === 0) return "Не менее 12 символов. Удобный вариант: несколько несвязанных слов.";
  if (length < 12) return `Сейчас ${length} из 12 символов. Добавьте ещё несколько символов.`;
  return "Минимальная длина соблюдена. Не используйте этот пароль на других сайтах.";
}

export function AuthClient({
  initialMode,
  initialSuccess,
  registrationEnabled,
}: {
  initialMode: AuthMode;
  initialSuccess: string;
  registrationEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<StatusState>(
    initialSuccess ? { kind: "success", message: initialSuccess, title: "Готово" } : null,
  );
  const [developmentToken, setDevelopmentToken] = useState("");
  const [token, setToken] = useState("");
  const [tokenReady, setTokenReady] = useState(false);
  const [passwordLength, setPasswordLength] = useState(0);
  const [passwordMismatch, setPasswordMismatch] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const passwordConfirmRef = useRef<HTMLInputElement>(null);
  const mountedMode = useRef(initialMode);

  useEffect(() => {
    const consumed = consumeAuthToken(window.location.href);
    window.history.replaceState(window.history.state, "", consumed.cleanUrl);
    setToken(consumed.token);
    setTokenReady(true);
  }, []);

  useEffect(() => {
    if (mountedMode.current === initialMode) return;
    mountedMode.current = initialMode;
    setStatus(null);
    setDevelopmentToken("");
    setPasswordLength(0);
    setPasswordMismatch(false);
    setPasswordVisible(false);
  }, [initialMode]);

  function resetStatus() {
    setStatus(null);
    setDevelopmentToken("");
  }

  function resetPasswordState() {
    setPasswordLength(0);
    setPasswordMismatch(false);
    setPasswordVisible(false);
  }

  function updatePasswordState() {
    const password = passwordRef.current?.value ?? "";
    const confirmation = passwordConfirmRef.current?.value ?? "";
    setPasswordLength(password.length);
    setPasswordMismatch(confirmation.length > 0 && confirmation !== password);
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
        router.replace(result.role === "customer" ? "/profile" : "/admin");
        router.refresh();
        return;
      }
      if (initialMode === "register") {
        const password = String(form.get("password") ?? "");
        if (password !== form.get("passwordConfirm")) throw new Error("Пароли не совпадают");
        if (form.get("personalDataConsent") !== "on") {
          throw new Error("Подтвердите согласие на обработку персональных данных");
        }
        const result = await apiRequest<MessageResponse>("/auth/register", {
          method: "POST",
          body: {
            displayName: form.get("displayName"),
            email: form.get("email"),
            password,
            personalDataConsent: true,
            personalDataConsentVersion: REGISTRATION_PERSONAL_DATA_CONSENT_VERSION,
          },
        });
        setStatus({
          kind: "success",
          message: result.message ?? "Если адрес подходит, инструкция будет отправлена.",
          title: "Проверьте почту",
        });
        setDevelopmentToken(result.developmentToken ?? "");
        element.reset();
        resetPasswordState();
        return;
      }
      if (initialMode === "forgot") {
        const result = await apiRequest<MessageResponse>("/auth/password/forgot", {
          method: "POST",
          body: { email: form.get("email") },
        });
        setStatus({
          kind: "success",
          message: result.message ?? "Если адрес подходит, инструкция будет отправлена.",
          title: "Проверьте почту",
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
          message: result.message ?? "Email подтверждён. Теперь можно войти.",
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
        resetPasswordState();
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
        message: result.message ?? "Пароль изменён. Теперь можно войти.",
        title: "Пароль изменён",
      });
      element.reset();
      resetPasswordState();
    } catch (caught) {
      setStatus(describeFailure(initialMode, caught));
    } finally {
      setPending(false);
    }
  }

  const context = modeContext[initialMode];
  const tokenRequired = initialMode === "verify" || initialMode === "reset" || initialMode === "staff-accept";
  const tokenMissing = tokenRequired && token.length < 32;
  const showPasswordConfirm = initialMode === "register" || initialMode === "reset" || initialMode === "staff-accept";
  const registerSucceeded = initialMode === "register" && status?.kind === "success";
  const registrationUnavailable = initialMode === "register" && !registrationEnabled;
  const verifySucceeded = initialMode === "verify" && status?.kind === "success";
  const resetSucceeded = initialMode === "reset" && status?.kind === "success";
  const passwordInputType = passwordVisible ? "text" : "password";
  const passwordControlIds = showPasswordConfirm ? "auth-password auth-password-confirm" : "auth-password";

  return (
    <div className={`${styles.page} ${authStyles.authPage}`}>
      <section className={authStyles.authIntro} aria-labelledby="auth-context-title">
        <p className={authStyles.contextLabel}>Личный кабинет АН-30</p>
        <h1 id="auth-context-title">{context.heading}</h1>
        <p className={authStyles.contextDescription}>{context.description}</p>
        <ul className={authStyles.benefitList}>
          {context.benefits.map((benefit) => (
            <li key={benefit.title}>
              <strong>{benefit.title}</strong>
              <span>{benefit.body}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={authStyles.formPanel} aria-labelledby="auth-form-title">
        {primaryModes.has(initialMode) ? (
          <nav className={authStyles.segmentedNav} aria-label="Действия с аккаунтом">
            {modeLabels.map((item) => (
              <Link
                key={item.mode}
                href={`/auth?mode=${item.mode}`}
                aria-current={initialMode === item.mode ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        ) : null}

        <header className={authStyles.formHeading}>
          <h2 id="auth-form-title">{modeTitles[initialMode]}</h2>
          <p>{modeDescriptions[initialMode]}</p>
        </header>

        <StatusBanner status={status} />

        {developmentToken ? (
          <p className={authStyles.devNotice}>
            Локальный режим почты: {" "}
            <Link href={`/auth?mode=${initialMode === "register" ? "verify" : "reset"}#token=${encodeURIComponent(developmentToken)}`}>
              открыть тестовую ссылку
            </Link>.
          </p>
        ) : null}

        {tokenRequired && !tokenReady ? (
          <div className={authStyles.loadingState} role="status">
            <strong>Проверяем одноразовую ссылку</strong>
            <span>Это займёт несколько секунд.</span>
          </div>
        ) : tokenMissing ? (
          <div className={`${styles.formError} ${authStyles.statusBanner}`} role="alert">
            <strong>Ссылка неполная</strong>
            <p>
              В адресе нет действующего токена. Возможно, ссылка скопирована не полностью или уже устарела. {" "}
              {initialMode === "verify" ? (
                <>Зарегистрируйтесь ещё раз на <Link href="/auth?mode=register">странице регистрации</Link>, чтобы получить новое письмо.</>
              ) : initialMode === "reset" ? (
                <>Запросите новую ссылку через <Link href="/auth?mode=forgot">восстановление пароля</Link>.</>
              ) : (
                <>Попросите администратора отправить новое приглашение.</>
              )}
            </p>
          </div>
        ) : registrationUnavailable ? (
          <div className={authStyles.unavailableState} role="status">
            <h3>Регистрация временно недоступна</h3>
            <p>Мы откроем создание аккаунтов после утверждения обязательных документов. Каталог и поиск товаров продолжают работать без регистрации.</p>
            <Link className={styles.primaryAction} href="/catalog">Перейти в каталог</Link>
          </div>
        ) : verifySucceeded || resetSucceeded ? (
          <div className={authStyles.successActions}>
            <Link className={styles.primaryAction} href="/auth?mode=login">Войти</Link>
          </div>
        ) : registerSucceeded ? (
          <div className={authStyles.nextStep}>
            <h3>Что сделать дальше</h3>
            <p>Откройте письмо от АН-30 и нажмите ссылку подтверждения. После этого вернитесь на страницу входа.</p>
            <p className={authStyles.fieldHint}>Письмо может попасть в папку «Спам». Если его нет, можно отправить регистрацию повторно.</p>
            <button
              className={authStyles.secondaryButton}
              type="button"
              onClick={() => {
                resetStatus();
                resetPasswordState();
              }}
            >
              Ввести email заново
            </button>
          </div>
        ) : (
          <form className={authStyles.stackForm} onSubmit={submit} aria-busy={pending}>
            {initialMode === "register" || initialMode === "staff-accept" ? (
              <div className={authStyles.formField}>
                <label htmlFor="auth-display-name">Имя</label>
                <input
                  id="auth-display-name"
                  name="displayName"
                  required
                  minLength={2}
                  maxLength={120}
                  autoComplete="name"
                />
              </div>
            ) : null}

            {initialMode === "login" || initialMode === "register" || initialMode === "forgot" ? (
              <div className={authStyles.formField}>
                <label htmlFor="auth-email">Email</label>
                <input
                  id="auth-email"
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                  inputMode="email"
                />
                {initialMode === "register" ? (
                  <small>На этот адрес придёт одноразовая ссылка подтверждения.</small>
                ) : null}
              </div>
            ) : null}

            {initialMode === "login" || initialMode === "register" || initialMode === "reset" || initialMode === "staff-accept" ? (
              <div className={authStyles.formField}>
                <label htmlFor="auth-password">{initialMode === "reset" ? "Новый пароль" : "Пароль"}</label>
                <div className={authStyles.passwordControl}>
                  <input
                    ref={passwordRef}
                    id="auth-password"
                    name="password"
                    type={passwordInputType}
                    required
                    minLength={initialMode === "login" ? 1 : 12}
                    maxLength={128}
                    autoComplete={initialMode === "login" ? "current-password" : "new-password"}
                    onInput={initialMode === "login" ? undefined : updatePasswordState}
                    aria-describedby={initialMode === "login" ? undefined : "auth-password-hint"}
                  />
                  <button
                    className={authStyles.passwordToggle}
                    type="button"
                    aria-controls={passwordControlIds}
                    aria-pressed={passwordVisible}
                    onClick={() => setPasswordVisible((visible) => !visible)}
                  >
                    {passwordVisible ? "Скрыть" : "Показать"}
                  </button>
                </div>
                {initialMode !== "login" ? (
                  <small
                    id="auth-password-hint"
                    className={passwordLength >= 12 ? authStyles.fieldSuccess : undefined}
                    aria-live="polite"
                  >
                    {passwordGuidance(passwordLength)}
                  </small>
                ) : null}
              </div>
            ) : null}

            {showPasswordConfirm ? (
              <div className={authStyles.formField}>
                <label htmlFor="auth-password-confirm">Повторите пароль</label>
                <input
                  ref={passwordConfirmRef}
                  id="auth-password-confirm"
                  name="passwordConfirm"
                  type={passwordInputType}
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  onInput={updatePasswordState}
                  aria-invalid={passwordMismatch}
                  aria-describedby={passwordMismatch ? "auth-password-mismatch" : undefined}
                />
                {passwordMismatch ? (
                  <small id="auth-password-mismatch" className={authStyles.fieldError} role="alert">
                    Пароли не совпадают
                  </small>
                ) : null}
              </div>
            ) : null}

            {initialMode === "register" ? (
              <div className={authStyles.consentBlock}>
                <label className={authStyles.consentField}>
                  <input
                    name="personalDataConsent"
                    type="checkbox"
                    required
                    aria-describedby="registration-consent-note"
                  />
                  <span>
                    Я даю согласие на обработку персональных данных для регистрации и использования личного кабинета на условиях документа {" "}
                    <Link href="/personal-data-consent" target="_blank" rel="noreferrer">
                      «Согласие на обработку персональных данных»
                    </Link>.
                  </span>
                </label>
                <p id="registration-consent-note">Это отдельное согласие. Без отметки аккаунт не создаётся.</p>
              </div>
            ) : null}

            <button
              className={`${styles.submitButton} ${authStyles.submitButton}`}
              type="submit"
              disabled={pending || (showPasswordConfirm && passwordMismatch)}
            >
              {pending ? submitLabels[initialMode].pending : submitLabels[initialMode].ready}
            </button>
          </form>
        )}

        {initialMode === "login" ? (
          <details className={authStyles.helpDetails}>
            <summary>Не получается войти?</summary>
            <ul>
              <li>Проверьте написание email и пароля.</li>
              <li>После регистрации сначала подтвердите email по ссылке из письма.</li>
              <li>После пяти неверных попыток вход закрывается на 15 минут.</li>
            </ul>
          </details>
        ) : null}

        <div className={authStyles.formLinks}>
          {initialMode === "login" ? <Link href="/auth?mode=forgot">Забыли пароль?</Link> : null}
          {!primaryModes.has(initialMode) ? <Link href="/auth?mode=login">Вернуться ко входу</Link> : null}
          <Link href="/privacy">Политика конфиденциальности</Link>
        </div>
      </section>
    </div>
  );
}
