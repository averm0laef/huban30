"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { readSession } from "../_lib/storefront-api";

interface AccountDestination {
  href: string;
  label: string;
}

const SessionNavigationContext = createContext<AccountDestination | null>(null);

export function SessionNavigationProvider({ children, initialSessionPresent }: { children: ReactNode; initialSessionPresent: boolean }) {
  const initialDestination = useMemo<AccountDestination>(() => initialSessionPresent
    ? { href: "/profile", label: "Кабинет" }
    : { href: "/auth?mode=login", label: "Войти" }, [initialSessionPresent]);
  const [destination, setDestination] = useState<AccountDestination>(initialDestination);

  useEffect(() => {
    let active = true;
    void readSession().then((session) => {
      if (!active) return;
      if (!session) {
        setDestination({ href: "/auth?mode=login", label: "Войти" });
      } else if (session.role === "customer") {
        setDestination({ href: "/profile", label: "Кабинет" });
      } else {
        setDestination({ href: "/admin", label: "Рабочее место" });
      }
    }).catch(() => {
      if (!initialSessionPresent && active) setDestination({ href: "/auth?mode=login", label: "Войти" });
    });
    return () => { active = false; };
  }, [initialSessionPresent]);

  return <SessionNavigationContext.Provider value={destination}>{children}</SessionNavigationContext.Provider>;
}

/** Read-only access to the same destination `AccountNavigation` renders, for
 * callers (the bottom tab bar) that need to know whether it is the current
 * route without duplicating the session lookup. */
export function useAccountDestination(): AccountDestination {
  const destination = useContext(SessionNavigationContext);
  if (!destination) throw new Error("useAccountDestination must be used inside SessionNavigationProvider");
  return destination;
}

/**
 * `icon` renders inside the `<Link>` itself (not beside it) so the header's
 * icon-above-caption action link is a single focusable/clickable region —
 * see the matching comment on `CartButton` in `cart-actions.tsx`.
 */
export function AccountNavigation({ className, icon, isCurrent }: { className?: string; icon?: ReactNode; isCurrent?: boolean }) {
  const destination = useAccountDestination();
  return (
    <Link className={className} href={destination.href} aria-current={isCurrent ? "page" : undefined}>
      {icon}
      <span className="storefront-account-label">{destination.label}</span>
    </Link>
  );
}
