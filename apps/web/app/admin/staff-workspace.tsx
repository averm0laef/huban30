"use client";

import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";

import { STAFF_SECTIONS } from "./sections";
import type { StaffSection } from "./sections";
import {
  Badge,
  Button,
  Checkbox,
  Field,
  FluentProvider,
  Input,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  webDarkTheme,
  webLightTheme,
} from "@fluentui/react-components";
import {
  Navigation20Regular,
  Shield20Regular,
  SignOut20Regular,
  WeatherMoon20Regular,
  WeatherSunny20Regular,
} from "@fluentui/react-icons";
import Link from "next/link";

import { ROLE_PERMISSIONS, type Permission } from "@an30/contracts";

import { api, ApiError } from "./api";
import type { SessionView } from "./types";
import { ROLE_LABELS } from "./workspace-utils";
import { StaffAvailability, availabilityPreferenceKey } from "./staff-availability";
import { AuditView } from "./views/audit";
import { CatalogView } from "./views/catalog";
import { ChatsView } from "./views/chats";
import { ClientHubView } from "./views/client-hub";
import { ImportsView } from "./views/imports";
import { InvoicesView } from "./views/invoices";
import { OrdersView } from "./views/orders";
import { OverviewView } from "./views/overview";
import { ReportsView } from "./views/reports";
import { RequestsView } from "./views/requests";
import { SettingsView } from "./views/settings";
import { TeamView } from "./views/team";
import styles from "./workspace.module.css";

// Re-exported for the existing client-side imports. The list itself lives in
// ./sections so server components can read it without crossing the "use
// client" boundary, where it would arrive as a reference proxy.
export { STAFF_SECTIONS };
export type { StaffSection };

interface NavigationItem {
  href: string;
  label: string;
  permission: Permission;
  section: StaffSection;
}

const NAVIGATION: NavigationItem[] = [
  { href: "/admin", label: "Сводка", permission: "orders:read:any", section: "overview" },
  { href: "/admin/orders", label: "Заказы", permission: "orders:read:any", section: "orders" },
  { href: "/admin/requests", label: "Обращения", permission: "requests:read:any", section: "requests" },
  { href: "/admin/chats", label: "Чаты", permission: "chat:manage:any", section: "chats" },
  { href: "/admin/client-hub", label: "Посты и мессенджеры", permission: "content:manage", section: "client-hub" },
  { href: "/admin/catalog", label: "Каталог", permission: "catalog:read", section: "catalog" },
  { href: "/admin/imports", label: "Импорт 1С", permission: "catalog:import", section: "imports" },
  { href: "/admin/invoices", label: "Накладные", permission: "orders:read:any", section: "invoices" },
  { href: "/admin/staff", label: "Персонал", permission: "staff:read", section: "staff" },
  { href: "/admin/reports", label: "Отчёты", permission: "reports:read", section: "reports" },
  { href: "/admin/settings", label: "Настройки", permission: "settings:manage", section: "settings" },
  { href: "/admin/audit", label: "Аудит", permission: "audit:read", section: "audit" },
];

type AuthState = "loading" | "ready" | "signed_out";

export function StaffWorkspace({ initialSection }: { initialSection: StaffSection }) {
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [session, setSession] = useState<SessionView | null>(null);
  const [authError, setAuthError] = useState<unknown>(null);
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [online, setOnline] = useState(true);

  const loadSession = useCallback(async () => {
    setAuthError(null);
    try {
      const current = await api<SessionView>("/auth/session");
      setSession(current);
      setAuthState("ready");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setSession(null);
        setAuthState("signed_out");
      } else {
        setAuthError(error);
        setAuthState("signed_out");
      }
    }
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem("an30-staff-theme");
    setTheme(saved === "dark" || saved === "light"
      ? saved
      : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setOnline(window.navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    void loadSession();
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [loadSession]);

  function toggleTheme(): void {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    window.localStorage.setItem("an30-staff-theme", next);
  }

  if (authState === "loading") {
    return (
      <FluentProvider theme={theme === "dark" ? webDarkTheme : webLightTheme} className={styles.provider}>
        <main className={styles.authShell}><Spinner label="Проверка защищённой сессии" /></main>
      </FluentProvider>
    );
  }

  return (
    <FluentProvider theme={theme === "dark" ? webDarkTheme : webLightTheme} className={styles.provider}>
      {!session ? (
        <LoginPanel authError={authError} onAuthenticated={loadSession} onTheme={toggleTheme} theme={theme} />
      ) : session.role === "customer" ? (
        <CustomerDenied session={session} onSignedOut={() => { setSession(null); setAuthState("signed_out"); }} />
      ) : !session.mfaVerified ? (
        <MfaPanel session={session} onVerified={loadSession} />
      ) : (
        <WorkspaceFrame
          initialSection={initialSection}
          navigationOpen={navigationOpen}
          online={online}
          onNavigation={() => setNavigationOpen((value) => !value)}
          onNavigationClose={() => setNavigationOpen(false)}
          onSignedOut={() => { setSession(null); setAuthState("signed_out"); }}
          onTheme={toggleTheme}
          session={session}
          theme={theme}
        />
      )}
    </FluentProvider>
  );
}

function LoginPanel({
  authError,
  onAuthenticated,
  onTheme,
  theme,
}: {
  authError: unknown;
  onAuthenticated: () => Promise<void>;
  onTheme: () => void;
  theme: "dark" | "light";
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(authError);

  async function login(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api("/auth/login", { body: JSON.stringify({ email, password }), method: "POST" });
      await onAuthenticated();
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.authShell}>
      <section className={styles.authPanel} aria-labelledby="login-title">
        <header className={styles.authBrand}>
          <Link href="/" aria-label="АН-30, открыть магазин"><strong>АН-30</strong><span>рабочее место</span></Link>
          <Button
            appearance="subtle"
            aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
            icon={theme === "dark" ? <WeatherSunny20Regular /> : <WeatherMoon20Regular />}
            onClick={onTheme}
          />
        </header>
        <div className={styles.authCopy}>
          <Badge appearance="tint" color="brand">Только для персонала</Badge>
          <h1 id="login-title">Вход в рабочую смену</h1>
          <p>После пароля потребуется TOTP или одноразовый резервный код.</p>
        </div>
        <form className={styles.authForm} onSubmit={(event) => { event.preventDefault(); void login(); }}>
          <Field label="Рабочий email" required>
            <Input autoComplete="username" onChange={(_event, data) => setEmail(data.value)} type="email" value={email} />
          </Field>
          <Field label="Пароль" required>
            <Input autoComplete="current-password" onChange={(_event, data) => setPassword(data.value)} type="password" value={password} />
          </Field>
          {error ? (
            <MessageBar intent="error"><MessageBarBody><MessageBarTitle>Вход не выполнен</MessageBarTitle>{error instanceof Error ? error.message : "Проверьте подключение."}</MessageBarBody></MessageBar>
          ) : null}
          <Button appearance="primary" disabled={busy || !email || !password} type="submit">{busy ? "Проверяем" : "Войти"}</Button>
        </form>
        <p className={styles.authFootnote}>Первый владелец создаётся только одноразовой командой внутри контейнера. Публичной регистрации администратора нет.</p>
      </section>
    </main>
  );
}

function MfaPanel({ session, onVerified }: { session: SessionView; onVerified: () => Promise<void> }) {
  const [setup, setSetup] = useState<{ provisioningUri: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [recorded, setRecorded] = useState(false);

  async function startSetup(): Promise<void> {
    setBusy(true);
    setError(null);
    try { setSetup(await api("/auth/totp/setup", { method: "POST" })); }
    catch (reason) { setError(reason); }
    finally { setBusy(false); }
  }

  async function verify(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ recoveryCodes?: string[] }>(session.mfaSetupRequired ? "/auth/totp/confirm" : "/auth/totp/verify", {
        body: JSON.stringify({ code: code.trim() }),
        method: "POST",
      });
      if (result.recoveryCodes) setRecoveryCodes(result.recoveryCodes);
      else await onVerified();
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }

  if (recoveryCodes) {
    return (
      <main className={styles.authShell}>
        <section className={styles.authPanel}>
          <Badge appearance="filled" color="warning">Показываются один раз</Badge>
          <h1>Сохраните резервные коды</h1>
          <p>Каждый код действует один раз. Храните их отдельно от пароля и устройства с TOTP.</p>
          <div className={styles.recoveryCodes}>{recoveryCodes.map((value) => <code key={value}>{value}</code>)}</div>
          <Checkbox checked={recorded} label="Я сохранил коды в безопасном месте" onChange={(_event, data) => setRecorded(data.checked === true)} />
          <Button appearance="primary" disabled={!recorded} onClick={() => void onVerified()}>Перейти в рабочее место</Button>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.authShell}>
      <section className={styles.authPanel} aria-labelledby="mfa-title">
        <Badge appearance="tint" color="brand">Защищённый вход</Badge>
        <h1 id="mfa-title">{session.mfaSetupRequired ? "Настройте TOTP" : "Подтвердите вход"}</h1>
        {session.mfaSetupRequired && !setup ? (
          <>
            <p>Подключите рабочий аккаунт к приложению-аутентификатору.</p>
            <Button appearance="primary" disabled={busy} onClick={() => void startSetup()}>Создать секрет</Button>
          </>
        ) : (
          <form className={styles.authForm} onSubmit={(event) => { event.preventDefault(); void verify(); }}>
            {setup ? (
              <div className={styles.secretBlock}>
                <span>Секрет для ручного ввода</span>
                <code>{setup.secret}</code>
                <details><summary>URI для приложения</summary><code>{setup.provisioningUri}</code></details>
              </div>
            ) : <p>Введите 6 цифр из приложения или одноразовый резервный код.</p>}
            <Field label="Код" required>
              <Input autoComplete="one-time-code" inputMode="numeric" maxLength={14} onChange={(_event, data) => setCode(data.value)} value={code} />
            </Field>
            {error ? <MessageBar intent="error"><MessageBarBody>{error instanceof Error ? error.message : "Код не принят."}</MessageBarBody></MessageBar> : null}
            <Button appearance="primary" disabled={busy || !code.trim()} type="submit">Подтвердить</Button>
          </form>
        )}
      </section>
    </main>
  );
}

function CustomerDenied({ session, onSignedOut }: { session: SessionView; onSignedOut: () => void }) {
  async function logout(): Promise<void> {
    await api("/auth/logout", { method: "POST" });
    onSignedOut();
  }
  return (
    <main className={styles.authShell}>
      <section className={styles.authPanel}>
        <Badge appearance="filled" color="danger">Доступ запрещён</Badge>
        <h1>Это рабочее место персонала</h1>
        <p>Аккаунт {session.email} имеет роль клиента. Сервер не разрешает доступ к данным сотрудников.</p>
        <Button onClick={() => void logout()}>Выйти</Button>
      </section>
    </main>
  );
}

function WorkspaceFrame({
  initialSection,
  navigationOpen,
  online,
  onNavigation,
  onNavigationClose,
  onSignedOut,
  onTheme,
  session,
  theme,
}: {
  initialSection: StaffSection;
  navigationOpen: boolean;
  online: boolean;
  onNavigation: () => void;
  onNavigationClose: () => void;
  onSignedOut: () => void;
  onTheme: () => void;
  session: SessionView;
  theme: "dark" | "light";
}) {
  const permissions: readonly Permission[] = ROLE_PERMISSIONS[session.role];
  const items = useMemo(() => NAVIGATION.filter((item) => permissions.includes(item.permission)), [permissions]);
  const allowed = items.some((item) => item.section === initialSection);

  async function logout(): Promise<void> {
    try { window.localStorage.removeItem(availabilityPreferenceKey(session.userId)); } catch { /* Optional local preference. */ }
    await api("/staff/availability", { method: "POST", body: JSON.stringify({ available: false }), signal: AbortSignal.timeout(3_000) }).catch(() => undefined);
    await api("/auth/logout", { method: "POST" });
    onSignedOut();
  }

  return (
    <div className={styles.workspace}>
      <a className={styles.skipLink} href="#workspace-main">К основному содержимому</a>
      {navigationOpen ? <button aria-label="Закрыть меню" className={styles.navBackdrop} onClick={onNavigationClose} type="button" /> : null}
      <aside className={styles.sidebar} data-open={navigationOpen || undefined}>
        <Link className={styles.workspaceBrand} href="/admin" onClick={onNavigationClose}>
          <strong>АН-30</strong><span>персонал</span>
        </Link>
        <nav aria-label="Разделы рабочего места" className={styles.workspaceNav}>
          {items.map((item) => (
            <Link
              aria-current={item.section === initialSection ? "page" : undefined}
              className={styles.navItem}
              href={item.href}
              key={item.section}
              onClick={onNavigationClose}
            >
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <span>{session.email}</span>
          <Badge appearance="outline">{ROLE_LABELS[session.role]}</Badge>
        </div>
      </aside>
      <div className={styles.workspaceBody}>
        <header className={styles.topbar}>
          <Button appearance="subtle" aria-label="Открыть меню" className={styles.menuButton} icon={<Navigation20Regular />} onClick={onNavigation} />
          <Badge appearance="tint" className={styles.networkBadge} color={online ? "success" : "danger"}>{online ? "Сеть доступна" : "Нет сети"}</Badge>
          <StaffAvailability key={session.userId} userId={session.userId} />
          <div className={styles.topbarActions}>
            <Button
              appearance="subtle"
              aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
              icon={theme === "dark" ? <WeatherSunny20Regular /> : <WeatherMoon20Regular />}
              onClick={onTheme}
            />
            <Button appearance="subtle" className={styles.signOutButton} aria-label="Выйти" icon={<SignOut20Regular />} onClick={() => void logout()}>Выйти</Button>
          </div>
        </header>
        {!online ? (
          <MessageBar intent="warning" className={styles.offlineBar}><MessageBarBody><MessageBarTitle>Работа без сети</MessageBarTitle>Данные могут устареть. Перед изменениями восстановите подключение.</MessageBarBody></MessageBar>
        ) : null}
        <main className={styles.mainContent} id="workspace-main" tabIndex={-1}>
          {allowed ? renderSection(initialSection, session) : (
            <section className={styles.forbiddenState}>
              <Shield20Regular />
              <h1>Недостаточно прав</h1>
              <p>Раздел скрыт для роли «{ROLE_LABELS[session.role]}». Даже прямой запрос будет отклонён сервером.</p>
              <Button as="a" href="/admin">Вернуться к сводке</Button>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

function renderSection(section: StaffSection, session: SessionView): ReactElement {
  switch (section) {
    case "audit": return <AuditView />;
    case "catalog": return <CatalogView />;
    case "chats": return <ChatsView session={session} />;
    case "client-hub": return <ClientHubView session={session} />;
    case "imports": return <ImportsView />;
    case "invoices": return <InvoicesView />;
    case "orders": return <OrdersView />;
    case "overview": return <OverviewView session={session} />;
    case "reports": return <ReportsView />;
    case "requests": return <RequestsView session={session} />;
    case "settings": return <SettingsView />;
    case "staff": return <TeamView session={session} />;
  }
}
