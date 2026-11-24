"use client";

import { EyeOff20Regular, Eye20Regular } from "@fluentui/react-icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";

import { REGISTRATION_PERSONAL_DATA_CONSENT_VERSION } from "@an30/contracts";

import { BrandLockup } from "./brand-mark";
import authStyles from "../auth/auth-flow.module.css";
import { consumeAuthToken } from "../_lib/auth-token";
import { apiRequest, errorText, StorefrontApiError } from "../_lib/storefront-api";
import { SocialLogin } from "./social-login";
import styles from "./storefront.module.css";
import { notifyAfterNavigation } from "../_lib/toast";
import { EmailField as MaskedEmailField } from "./masked-fields";

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

const primaryModes = new Set<AuthMode>(["login", "register"]);

const modeLabels: Array<{ label: string; mode: AuthMode }> = [
  { label: "Вход", mode: "login" },
  { label: "Регистрация", mode: "register" },
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
  login: "",
  register: "Сохраняйте детали в избранном и следите за заказами.",
  reset: "Придумайте новую парольную фразу для аккаунта.",
  "staff-accept": "Укажите имя и задайте пароль, чтобы завершить приглашение.",
  verify: "Введите пароль, который вы указали при регистрации.",
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
      {status.message !== status.title && <p>{status.message}</p>}
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

/* ----------------------------------------------------------------------
 * Field building blocks — one small, stable component per input, each
 * carrying only the markup/attributes that field ever needs. AuthClient
 * below composes these per mode (see `renderFields`) instead of one form
 * asking "which mode am I?" at every field. Declared at module scope (not
 * inside AuthClient) so their identity never changes between renders —
 * nesting them inside the component would force React to remount every
 * field, and the input under the user's cursor, on each keystroke.
 * ---------------------------------------------------------------------- */

function NameField() {
  return (
    <div className={authStyles.formField}>
      <label htmlFor="auth-display-name">Имя</label>
      <input id="auth-display-name" name="displayName" required minLength={2} maxLength={120} autoComplete="name" />
    </div>
  );
}

function EmailField({ registerHint }: { registerHint?: boolean }) {
  return (
    <div className={authStyles.formField}>
      <label htmlFor="auth-email">Email</label>
      <MaskedEmailField id="auth-email" name="email" required maxLength={254}
        aria-describedby={registerHint ? "auth-email-hint" : undefined} />
      {registerHint ? <small id="auth-email-hint">На этот адрес придёт ссылка для подтверждения регистрации.</small> : null}
    </div>
  );
}

interface PasswordVisibilityProps {
  inputRef: RefObject<HTMLInputElement | null>;
  inputType: "password" | "text";
  onToggleVisible: () => void;
  visible: boolean;
}

function PasswordToggle({
  controls,
  visible,
  onClick,
}: { controls: string; visible: boolean; onClick: () => void }) {
  return (
    <button className={authStyles.passwordToggle} type="button" aria-controls={controls}
      aria-label={visible ? "Скрыть пароль" : "Показать пароль"} onClick={onClick}>
      {visible ? <EyeOff20Regular aria-hidden="true" /> : <Eye20Regular aria-hidden="true" />}
    </button>
  );
}

function LoginPasswordField({ inputRef, inputType, onToggleVisible, visible }: PasswordVisibilityProps) {
  return (
    <div className={authStyles.formField}>
      <div className={authStyles.fieldHeading}>
        <label htmlFor="auth-password">Пароль</label>
        <Link href="/auth?mode=forgot">Забыли пароль?</Link>
      </div>
      <div className={authStyles.passwordControl}>
        <input
          ref={inputRef}
          id="auth-password"
          name="password"
          type={inputType}
          required
          minLength={1}
          maxLength={128}
          autoComplete="current-password"
        />
        <PasswordToggle controls="auth-password" visible={visible} onClick={onToggleVisible} />
      </div>
    </div>
  );
}

function NewPasswordField({
  confirm = false,
  inputRef,
  inputType,
  label,
  onInput,
  onToggleVisible,
  passwordLength,
  visible,
}: PasswordVisibilityProps & { confirm?: boolean; label: string; onInput: () => void; passwordLength: number }) {
  return (
    <div className={authStyles.formField}>
      <label htmlFor="auth-password">{label}</label>
      <div className={authStyles.passwordControl}>
        <input
          ref={inputRef}
          id="auth-password"
          name="password"
          type={inputType}
          required
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
          onInput={onInput}
          aria-describedby="auth-password-hint"
        />
        <PasswordToggle controls={confirm ? "auth-password auth-password-confirm" : "auth-password"}
          visible={visible} onClick={onToggleVisible} />
      </div>
      <small id="auth-password-hint" className={passwordLength >= 12 ? authStyles.fieldSuccess : undefined} aria-live="polite">
        {passwordGuidance(passwordLength)}
      </small>
    </div>
  );
}

function PasswordConfirmField({
  inputRef,
  inputType,
  mismatch,
  onInput,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  inputType: "password" | "text";
  mismatch: boolean;
  onInput: () => void;
}) {
  return (
    <div className={authStyles.formField}>
      <label htmlFor="auth-password-confirm">Повторите пароль</label>
      <input
        ref={inputRef}
        id="auth-password-confirm"
        name="passwordConfirm"
        type={inputType}
        required
        minLength={12}
        maxLength={128}
        autoComplete="new-password"
        onInput={onInput}
        aria-invalid={mismatch}
        aria-describedby={mismatch ? "auth-password-mismatch" : undefined}
      />
      {mismatch ? (
        <small id="auth-password-mismatch" className={authStyles.fieldError} role="alert">
          Пароли не совпадают
        </small>
      ) : null}
    </div>
  );
}

function ConsentField() {
  return (
    <div className={authStyles.consentBlock}>
      <label className={authStyles.consentField}>
        <input name="personalDataConsent" type="checkbox" required aria-describedby="registration-consent-note" />
        <span>
          Я даю согласие на обработку персональных данных для регистрации и использования личного кабинета на условиях документа {" "}
          <Link href="/personal-data-consent" target="_blank" rel="noreferrer">
            «Согласие на обработку персональных данных»
          </Link>.
        </span>
      </label>
      <label className={authStyles.consentField}>
        <input name="termsAccepted" type="checkbox" required />
        <span>
          Я принимаю {" "}<Link href="/terms" target="_blank" rel="noreferrer">условия работы магазина</Link>{" "}
          и ознакомлен(а) с {" "}<Link href="/privacy" target="_blank" rel="noreferrer">политикой конфиденциальности</Link>.
        </span>
      </label>
      <p id="registration-consent-note">Обе отметки обязательны. Согласие на обработку данных оформлено отдельным документом.</p>
    </div>
  );
}

export function AuthClient({
  initialMode,
  initialSuccess,
  registrationEnabled,
  socialStatus,
}: {
  initialMode: AuthMode;
  initialSuccess: string;
  registrationEnabled: boolean;
  socialStatus?: string;
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
  const tokenRead = useRef(false);

  useEffect(() => {
    if (tokenRead.current) return;
    tokenRead.current = true;
    const consumed = consumeAuthToken(window.location.href);
    window.history.replaceState(window.history.state, "", consumed.cleanUrl);
    setToken(consumed.token);
    setTokenReady(true);
  }, []);

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
        // Staff go to /admin, which has no storefront notifications: theirs would surface later on a random page.
        if (result.role === "customer") notifyAfterNavigation({ kind: "success", title: "Вы вошли в кабинет" });
        router.replace(result.role === "customer" ? "/profile" : "/admin");
        router.refresh();
        return;
      }
      if (initialMode === "register") {
        const password = String(form.get("password") ?? "");
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
          body: { token, password: form.get("password") },
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

  const tokenRequired = initialMode === "verify" || initialMode === "reset" || initialMode === "staff-accept";
  const tokenMissing = tokenRequired && token.length < 32;
  const registerSucceeded = initialMode === "register" && status?.kind === "success";
  const forgotSucceeded = initialMode === "forgot" && status?.kind === "success";
  const registrationUnavailable = initialMode === "register" && !registrationEnabled;
  const verifySucceeded = initialMode === "verify" && status?.kind === "success";
  const resetSucceeded = initialMode === "reset" && status?.kind === "success";
  const passwordInputType = passwordVisible ? "text" : "password";

  const passwordControls: PasswordVisibilityProps = {
    inputRef: passwordRef,
    inputType: passwordInputType,
    onToggleVisible: () => setPasswordVisible((current) => !current),
    visible: passwordVisible,
  };
  const confirmControls: Parameters<typeof PasswordConfirmField>[0] = {
    inputRef: passwordConfirmRef,
    inputType: passwordInputType,
    mismatch: passwordMismatch,
    onInput: updatePasswordState,
  };

  // Every mode lists its own fields explicitly instead of each field asking
  // "am I visible in this mode?" — the six screens read as purpose-built
  // even though they share the same small set of field components.
  function renderFields() {
    switch (initialMode) {
      case "login":
        return (
          <>
            <EmailField />
            <LoginPasswordField {...passwordControls} />
          </>
        );
      case "register":
        return (
          <>
            <NameField />
            <EmailField registerHint />
            <NewPasswordField {...passwordControls} label="Пароль" onInput={updatePasswordState} passwordLength={passwordLength} />
            <ConsentField />
          </>
        );
      case "forgot":
        return <EmailField />;
      case "reset":
        return (
          <>
            <NewPasswordField {...passwordControls} confirm label="Новый пароль" onInput={updatePasswordState} passwordLength={passwordLength} />
            <PasswordConfirmField {...confirmControls} />
          </>
        );
      case "staff-accept":
        return (
          <>
            <NameField />
            <NewPasswordField {...passwordControls} confirm label="Пароль" onInput={updatePasswordState} passwordLength={passwordLength} />
            <PasswordConfirmField {...confirmControls} />
          </>
        );
      case "verify":
        return <LoginPasswordField {...passwordControls} />;
    }
  }

  const showPasswordConfirm = initialMode === "reset" || initialMode === "staff-accept";

  return (
    <div className={`${styles.page} ${authStyles.authPage}`}>
      <div className={authStyles.authShell}>
      <aside className={authStyles.brandPanel} aria-label="Личный кабинет АН-30">
        <BrandLockup className={authStyles.brandLogo} tone="current" />
        <p className={authStyles.brandTitle}>Личный кабинет покупателя</p>
        <ul className={authStyles.brandBenefits}>
          <li>Статус заказов и история покупок</li>
          <li>Мой автомобиль — подбор без повторного ввода</li>
          <li>Переписка с магазином в одном месте</li>
        </ul>
        <span className={authStyles.brandCar} aria-hidden="true" />
      </aside>
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
          <h1 id="auth-form-title">{modeTitles[initialMode]}</h1>
          {modeDescriptions[initialMode] && <p>{modeDescriptions[initialMode]}</p>}
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
              Похоже, ссылка из письма открылась не полностью или уже устарела. {" "}
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
            <h2>Регистрация временно недоступна</h2>
            <p>Мы откроем создание аккаунтов после утверждения обязательных документов. Каталог и поиск товаров продолжают работать без регистрации.</p>
            <Link className={styles.primaryAction} href="/catalog">Перейти в каталог</Link>
          </div>
        ) : verifySucceeded || resetSucceeded ? (
          <div className={authStyles.successActions}>
            <Link className={styles.primaryAction} href="/auth?mode=login">Войти</Link>
          </div>
        ) : forgotSucceeded ? (
          <div className={authStyles.nextStep}>
            <p>Если письмо не пришло, проверьте папку «Спам» или уточните адрес.</p>
            <button className={authStyles.secondaryButton} type="button" onClick={resetStatus}>
              Ввести другой email
            </button>
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
            {renderFields()}

            <button
              className={`${styles.submitButton} ${authStyles.submitButton}`}
              type="submit"
              disabled={pending || (showPasswordConfirm && passwordMismatch)}
            >
              <span>{pending ? submitLabels[initialMode].pending : submitLabels[initialMode].ready}</span>
            </button>
          </form>
        )}

        {initialMode === "login" && <SocialLogin status={socialStatus} />}
        <div className={authStyles.formLinks}>
          {!primaryModes.has(initialMode) ? <Link href="/auth?mode=login">Вернуться ко входу</Link> : null}
          <Link href="/privacy">Политика конфиденциальности</Link>
        </div>
      </section>
      </div>

    </div>
  );
}
