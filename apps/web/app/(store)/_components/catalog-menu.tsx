"use client";

import { Apps24Regular, ChevronDown16Regular, ChevronRight16Regular, Grid24Regular } from "@fluentui/react-icons";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { aimVerdict, type Point } from "../_lib/menu-aim";
import type { CatalogMenuSection } from "../_lib/store-categories";
import styles from "./storefront.module.css";

/** How long a section under the pointer waits before taking over while the pointer is heading for the subsections. */
const AIM_PATIENCE_MS = 300;
/** How many of the pointer's last positions say where it is heading. */
const TRAIL_LENGTH = 3;

/**
 * «Каталог» in the header: a link to /catalog that also opens a panel — the sections on the left, the
 * subsections of the one in hand on the right. A mouse opens it by hovering and picks a section by pointing at
 * it; the keyboard and touch use the arrow next to «Каталог» and the arrow in each section's row. With no
 * sections (the catalogue did not answer) it is the plain link it used to be.
 */
export function CatalogMenu({ sections }: { sections: CatalogMenuSection[] }) {
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const aimTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointerInside = useRef(false);
  const trail = useRef<Point[]>([]);
  const chosen = useRef<string | null>(null);
  const [mode, setMode] = useState<"hover" | "click" | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const open = mode !== null;
  const active = sections.find(({ key }) => key === activeKey) ?? sections[0];

  useEffect(() => () => {
    clearTimeout(hoverTimer.current);
    clearTimeout(aimTimer.current);
  }, []);

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

  const link = (
    <Link className={styles.headerCatalogButton} href="/catalog" onClick={() => setMode(null)}>
      <Grid24Regular aria-hidden="true" /> <span>Каталог</span>
    </Link>
  );
  if (!active) return link;

  function choose(key: string) {
    clearTimeout(aimTimer.current);
    chosen.current = key;
    setActiveKey(key);
  }

  /**
   * The pointer is on a section. The subsections of the section in hand sit to the right, and the way to them
   * crosses other sections: while the pointer is heading there, the one under it waits; once the pointer stops or
   * turns, it takes over (_lib/menu-aim.ts). `waitedAt` is null when the pointer has only just come onto the
   * section, and the place it was at when this section last decided to wait otherwise.
   */
  function consider(key: string, waitedAt: Point | null = null) {
    clearTimeout(aimTimer.current);
    if (key === (chosen.current ?? sections[0]?.key)) return;
    const listBox = list.current?.getBoundingClientRect();
    const panelBox = panel.current?.getBoundingClientRect();
    const verdict = listBox && panelBox
      ? aimVerdict(trail.current, { bottom: panelBox.bottom, left: listBox.right, top: panelBox.top }, waitedAt)
      : "pick";
    if (verdict === "pick") {
      choose(key);
      return;
    }
    const at = trail.current.at(-1) ?? null;
    aimTimer.current = setTimeout(() => consider(key, at), AIM_PATIENCE_MS);
  }

  return (
    <div className={styles.catalogMenu} ref={root}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        // A press on something that does not take the focus (Safari does not focus a button) is not a way out.
        if (event.relatedTarget === null && pointerInside.current) return;
        setMode(null);
      }}
      onPointerEnter={(event) => {
        pointerInside.current = true;
        if (event.pointerType !== "mouse") return;
        clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => setMode((current) => current ?? "hover"), 120);
      }}
      onPointerLeave={(event) => {
        pointerInside.current = false;
        if (event.pointerType !== "mouse") return;
        clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => {
          if (!root.current?.querySelector(":focus-visible")) setMode(null);
        }, 180);
      }}>
      {link}
      <button aria-controls={panelId} aria-expanded={open} aria-label="Меню каталога" className={styles.catalogMenuToggle}
        ref={trigger} type="button"
        onClick={() => {
          clearTimeout(hoverTimer.current);
          setMode((current) => current === "click" ? null : "click");
        }}>
        <ChevronDown16Regular aria-hidden="true" />
      </button>
      {/* The panel's contents are drawn only while it is open, and only the section in hand has its subsections
          drawn: drawn whole on the server, the panel put 78 KB of markup into every page of the shop. */}
      <nav aria-label="Меню каталога" className={styles.catalogMenuPanel} hidden={!open} id={panelId} ref={panel}>
        {open && <ul className={styles.catalogMenuSections} ref={list}
          onPointerLeave={() => { trail.current = []; }}
          onPointerMove={(event) => {
            if (event.pointerType !== "mouse") return;
            trail.current = [...trail.current.slice(1 - TRAIL_LENGTH), { x: event.clientX, y: event.clientY }];
          }}>
          {sections.map((section) => {
            const isActive = section.key === active.key;
            const detailId = `${panelId}-${section.key}`;
            return (
              <li data-active={isActive ? "" : undefined} key={section.key}
                onPointerEnter={(event) => { if (event.pointerType === "mouse") consider(section.key); }}
                onPointerLeave={(event) => { if (event.pointerType === "mouse") clearTimeout(aimTimer.current); }}>
                <Link href={section.href} prefetch={false} onClick={() => setMode(null)}>
                  {section.image
                    ? <Image alt="" height={32} sizes="32px" src={section.image} width={32} />
                    : <Apps24Regular aria-hidden="true" />}
                  <span>{section.label}</span>
                </Link>
                {section.children.length > 0 && (
                  <button aria-controls={isActive ? detailId : undefined} aria-expanded={isActive}
                    aria-label={`Подразделы: ${section.label}`} type="button" onClick={() => choose(section.key)}>
                    <ChevronRight16Regular aria-hidden="true" />
                  </button>
                )}
                {isActive && <div className={styles.catalogMenuDetail} id={detailId}>
                  <Link className={styles.catalogMenuDetailTitle} href={section.href} prefetch={false} onClick={() => setMode(null)}>
                    <strong>{section.label}</strong> <span>Все товары раздела</span>
                  </Link>
                  {section.children.length > 0 && (
                    <ul>
                      {section.children.map((child) => (
                        <li key={child.key}>
                          <Link href={child.href} prefetch={false} onClick={() => setMode(null)}>{child.label}</Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>}
              </li>
            );
          })}
        </ul>}
      </nav>
    </div>
  );
}
