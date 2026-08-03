"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { CatalogProductsResponseSchema } from "@an30/contracts";
import type { CatalogProductSummary } from "@an30/contracts";

import { formatRubles } from "../_lib/catalog-format";
import styles from "./storefront.module.css";

const DEBOUNCE_MS = 220;
const SUGGESTION_LIMIT = 6;
const MIN_QUERY_LENGTH = 2;

type SuggestState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "empty" }
  | { status: "ready"; items: CatalogProductSummary[] };

function SearchIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

/**
 * Header search: a real `GET /catalog?q=` form (works with JS disabled and
 * is what actually runs the search) enhanced with a debounced suggestions
 * dropdown against the live catalog endpoint. The dropdown never invents
 * results — "loading" / "nothing found" / a network error are all shown
 * honestly, and an empty catalog just means the dropdown says so.
 */
export function HeaderSearchForm({ id }: { id: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [state, setState] = useState<SuggestState>({ status: "idle" });
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listboxId = `${id}-listbox`;
  const items = state.status === "ready" ? state.items : [];

  useEffect(() => {
    const query = value.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      abortRef.current?.abort();
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading" });
    const timer = window.setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      const parameters = new URLSearchParams({ limit: String(SUGGESTION_LIMIT), q: query });
      fetch(`/api/v1/catalog/products?${parameters.toString()}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error("bad status"))))
        .then((payload: unknown) => {
          const parsed = CatalogProductsResponseSchema.safeParse(payload);
          if (!parsed.success) {
            setState({ status: "error" });
            return;
          }
          setState(parsed.data.items.length > 0 ? { items: parsed.data.items, status: "ready" } : { status: "empty" });
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setState({ status: "error" });
        });
    }, DEBOUNCE_MS);
    // Cancels both an unfired debounce timer and any in-flight request from
    // the previous keystroke — runs on every value change and on unmount.
    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [value]);

  useEffect(() => setActiveIndex(-1), [state]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      if (items.length === 0) return;
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index + 1) % items.length);
    } else if (event.key === "ArrowUp") {
      if (items.length === 0) return;
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index <= 0 ? items.length - 1 : index - 1));
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
    } else if (event.key === "Enter" && open && activeIndex >= 0 && items[activeIndex]) {
      event.preventDefault();
      setOpen(false);
      router.push(`/catalog/product/${encodeURIComponent(items[activeIndex].slug)}`);
    }
  }

  const query = value.trim();
  const showPanel = open && query.length >= MIN_QUERY_LENGTH;

  return (
    <div
      className={styles.searchBox}
      ref={rootRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <form action="/catalog" autoComplete="off" className={styles.searchForm} method="get" onSubmit={() => setOpen(false)} role="search">
        <label className={styles.visuallyHidden} htmlFor={id}>Поиск по VIN, названию или артикулу</label>
        <SearchIcon />
        <input
          aria-activedescendant={activeIndex >= 0 && items[activeIndex] ? `${id}-option-${items[activeIndex].id}` : undefined}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={showPanel}
          id={id}
          maxLength={120}
          minLength={2}
          name="q"
          onChange={(event) => {
            setValue(event.target.value);
            setOpen(true);
          }}
          onFocus={() => { if (query.length >= MIN_QUERY_LENGTH) setOpen(true); }}
          onKeyDown={handleKeyDown}
          placeholder="VIN, название или артикул"
          role="combobox"
          type="search"
          value={value}
        />
        <button aria-label="Найти в каталоге" type="submit">Найти</button>
      </form>
      {showPanel ? (
        <div aria-label="Подсказки поиска" className={styles.searchSuggestions} id={listboxId} role="listbox">
          {state.status === "loading" ? <p className={styles.searchSuggestionStatus}>Ищем…</p> : null}
          {state.status === "error" ? <p className={styles.searchSuggestionStatus}>Не удалось загрузить подсказки. Нажмите «Найти», чтобы открыть каталог.</p> : null}
          {state.status === "empty" ? <p className={styles.searchSuggestionStatus}>Ничего не найдено</p> : null}
          {state.status === "ready" ? items.map((item, index) => (
            <Link
              aria-selected={index === activeIndex}
              className={styles.searchSuggestion}
              data-active={index === activeIndex || undefined}
              href={`/catalog/product/${encodeURIComponent(item.slug)}`}
              id={`${id}-option-${item.id}`}
              key={item.id}
              onClick={() => setOpen(false)}
              onMouseEnter={() => setActiveIndex(index)}
              role="option"
            >
              <span className={styles.searchSuggestionName}>{item.name}</span>
              <span className={styles.searchSuggestionMeta}>{item.brand ? `${item.brand.name} · ` : ""}Артикул {item.sku}</span>
              <span className={styles.searchSuggestionPrice}>{item.priceKopeks === null ? "Цена уточняется" : formatRubles(item.priceKopeks)}</span>
            </Link>
          )) : null}
          {state.status === "ready" ? (
            <Link className={styles.searchSuggestionAll} href={`/catalog?q=${encodeURIComponent(query)}`} onClick={() => setOpen(false)}>
              Все результаты по запросу «{query}»
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
