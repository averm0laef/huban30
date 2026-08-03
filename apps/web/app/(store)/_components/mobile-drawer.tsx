"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";

import styles from "./storefront.module.css";

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function BurgerIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

/**
 * Mobile burger menu: a real slide-in drawer (not the old inline
 * `<details>` list). While open it traps focus, closes on Escape or a
 * backdrop click, and locks the page behind it from scrolling. The panel
 * stays mounted at all times (translated off-screen + `inert` while
 * closed) so open/close both get a genuine CSS transition instead of a
 * mount-timing hack, and closed content is neither focusable nor exposed
 * to assistive tech.
 */
export function MobileDrawer({ brand, children }: { brand: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";

    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    const trigger = triggerRef.current;
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      root.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [open, close]);

  function handlePanelClick(event: MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("a")) close();
  }

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className={styles.burgerButton}
        onClick={() => setOpen(true)}
        ref={triggerRef}
        type="button"
      >
        <BurgerIcon />
        <span className={styles.visuallyHidden}>Открыть меню</span>
      </button>
      <div className={styles.drawerLayer} data-open={open || undefined}>
        <button aria-hidden="true" className={styles.drawerBackdrop} onClick={close} tabIndex={-1} type="button" />
        <div
          aria-label="Меню навигации"
          aria-modal="true"
          className={styles.drawerPanel}
          inert={!open}
          onClick={handlePanelClick}
          ref={panelRef}
          role="dialog"
        >
          <div className={styles.drawerHead}>
            {brand}
            <button aria-label="Закрыть меню" className={styles.drawerClose} onClick={close} type="button">
              <CloseIcon />
            </button>
          </div>
          <div className={styles.drawerBody}>{children}</div>
        </div>
      </div>
    </>
  );
}
