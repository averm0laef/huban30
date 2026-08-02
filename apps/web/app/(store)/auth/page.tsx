import type { Metadata } from "next";

import { AuthClient, type AuthMode } from "../_components/auth-client";

export const metadata: Metadata = {
  title: "Вход и регистрация",
  description: "Безопасный вход, регистрация и восстановление доступа к личному кабинету АН-30.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface AuthPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const modes = new Set<AuthMode>(["login", "register", "forgot", "verify", "reset", "staff-accept"]);

export default async function AuthPage({ searchParams }: AuthPageProps) {
  const query = await searchParams;
  const rawMode = Array.isArray(query.mode) ? query.mode[0] : query.mode;
  const mode = rawMode && modes.has(rawMode as AuthMode)
    ? rawMode as AuthMode
    : "login";
  const accepted = (Array.isArray(query.accepted) ? query.accepted[0] : query.accepted) === "1";

  return <AuthClient initialMode={mode} initialSuccess={accepted ? "Приглашение принято. Войдите и настройте TOTP" : ""} />;
}
