"use client";

import { ChevronDown16Regular } from "@fluentui/react-icons";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import buttons from "./store-button.module.css";
import styles from "./storefront.module.css";

export function StoreHeaderMenu({ label, links, help }: {
  label: string;
  links: readonly { href: string; label: string; description: string }[];
  help?: boolean;
}) {
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [mode, setMode] = useState<"hover" | "click" | null>(null);
  const open = mode !== null;

  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setMode(null);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (root.current?.contains(document.activeElement)) {
        event.preventDefault();
        trigger.current?.focus();
      }
      setMode(null);
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [open]);

  return (
    <div className={styles.headerMenu} data-help={help || undefined} ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setMode(null);
      }}
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse") return;
        clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => setMode((current) => current ?? "hover"), 120);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "mouse") return;
        clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => {
          if (!root.current?.querySelector(":focus-visible")) setMode(null);
        }, 180);
      }}>
      <button aria-controls={panelId} aria-expanded={open} className={styles.headerMenuTrigger} ref={trigger} type="button"
        onClick={() => {
          clearTimeout(hoverTimer.current);
          setMode((current) => current === "click" ? null : "click");
        }}>
        {label} <ChevronDown16Regular aria-hidden="true" />
      </button>
      <div id={panelId} hidden={!open} className={styles.headerMenuPanel} data-help={help || undefined}>
        <ul className={styles.headerMenuLinks}>
          {links.map((link) => (
            <li key={link.href}>
              <Link href={link.href} onClick={() => setMode(null)}>
                <strong>{link.label}</strong>
                <span>{link.description}</span>
              </Link>
            </li>
          ))}
        </ul>
        {help && (
          <div className={styles.headerMenuHelp}>
            <div>
              <strong>Нужна помощь с подбором?</strong>
              <p>Укажите марку или VIN — покажем подходящие детали и аналоги.</p>
            </div>
            <Link className={`${buttons.button} ${buttons.accent}`} href="/podbor" onClick={() => setMode(null)}>
              Подобрать деталь
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
