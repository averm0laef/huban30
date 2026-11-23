"use client";

import { ChevronRight16Regular, Clock20Regular, Search20Regular } from "@fluentui/react-icons";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import { CatalogProductsResponseSchema, type CatalogProductSummary } from "@an30/contracts";

import { formatRubles } from "../_lib/catalog-format";
import { placeholderSequence, SEARCH_HINT, typingFrames } from "../_lib/search-placeholder";
import { catalogSearchHref } from "../_lib/catalog-search-url";
import { clearRecentCatalogSearches, readRecentCatalogSearches, rememberCatalogSearch } from "../_lib/recent-catalog-searches";
import { searchServiceLinks, suggestedCatalogSections } from "../_lib/search-guidance";
import { categoryHrefBySlug, exactCategoryMatch, highlightParts, matchCategories, swapKeyboardLayout, type FlatCategory } from "../_lib/search-assist";
import { catalogCategoryPhoto, categoryTiles, featuredCategoryKeys } from "../_lib/store-categories";
import { EXPERT_HELP_VIN_STORAGE_KEY, isValidVin } from "../_lib/vin";
import { ExpertHelpQueryLink } from "../catalog/expert-help-query-link";
import { CatalogPhoto } from "./catalog-photo";
import styles from "./storefront.module.css";

const DEBOUNCE_MS = 220;
const popularSections = categoryTiles.filter(({ key }) => featuredCategoryKeys.has(key)).slice(0, 6);

function Highlighted({ query, text }: { query: string; text: string }) {
  return <>{highlightParts(text, query).map((part, index) => part.match ? <mark key={index}>{part.text}</mark> : part.text)}</>;
}
const SUGGESTION_LIMIT = 6;

type SuggestState =
  | { status: "idle" | "loading" | "error" | "empty" }
  | { status: "ready"; items: CatalogProductSummary[]; total: number };

/**
 * Types example queries into an empty, unfocused search field, the way big
 * parts shops hint what can be searched. Stops while the customer types,
 * when the tab is hidden and for prefers-reduced-motion (plain hint then).
 */
function useTypingPlaceholder(enabled: boolean, fallback: string): string {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setText(null);
      return;
    }
    const sequence = placeholderSequence();
    let line = 0;
    let frames = typingFrames(sequence[0]!);
    let frame = 0;
    let timer = window.setTimeout(function tick() {
      if (document.hidden) {
        timer = window.setTimeout(tick, 1000);
        return;
      }
      const current = frames[frame]!;
      setText(current.text);
      frame += 1;
      if (frame >= frames.length) {
        line = (line + 1) % sequence.length;
        frames = typingFrames(sequence[line]!);
        frame = 0;
      }
      timer = window.setTimeout(tick, current.delay);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [enabled]);
  return text === null ? fallback : `${text}▏`;
}

export function HeaderSearchForm({ id, compact = false }: { id: string; compact?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const parameters = useSearchParams();
  // The header searches the whole catalogue, so it repeats a text only on that search's own page. Inside a section
  // the text belongs to the section's own field («Найти в разделе …»).
  const routeQuery = pathname === "/catalog" ? parameters?.get("q")?.trim().slice(0, 120) ?? "" : "";
  const [value, setValue] = useState(routeQuery);
  const [state, setState] = useState<SuggestState>({ status: "idle" });
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const placeholder = useTypingPlaceholder(!focused && value === "", compact ? "Артикул или название" : SEARCH_HINT);
  const [history, setHistory] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [categories, setCategories] = useState<FlatCategory[] | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listboxId = `${id}-listbox`;
  const popupId = `${id}-suggestions`;
  const query = value.trim();
  const vin = isValidVin(query);
  const items = state.status === "ready" ? state.items : [];
  const serviceLinks = query.length >= 2 ? searchServiceLinks(query) : [];
  const categoryLinks = state.status === "empty" ? suggestedCatalogSections(query) : [];
  const sectionMatches = query.length >= 2 && categories ? matchCategories(categories, query) : [];
  const layoutHint = state.status === "empty" ? swapKeyboardLayout(query) : null;
  const showHistory = open && !query && history.length > 0;
  const showStart = open && !query;
  const showPanel = open && (showStart || (query.length >= 2 && !vin));

  // Section names for the "Разделы" row, loaded once the field is first used.
  useEffect(() => {
    if (!open || categories !== null) return;
    const controller = new AbortController();
    fetch("/api/v1/catalog/categories", { headers: { Accept: "application/json" }, signal: controller.signal })
      .then(async (response) => (response.ok ? (await response.json()) as { items?: unknown } : { items: [] }))
      .then(({ items }) => {
        const list = Array.isArray(items) ? items.filter((item): item is FlatCategory =>
          typeof item === "object" && item !== null
          && typeof (item as FlatCategory).id === "string" && typeof (item as FlatCategory).name === "string"
          && typeof (item as FlatCategory).slug === "string" && typeof (item as FlatCategory).productCount === "number") : [];
        setCategories(list);
      })
      .catch(() => { if (!controller.signal.aborted) setCategories([]); });
    return () => controller.abort();
  }, [open, categories]);

  useEffect(() => {
    setValue(routeQuery);
    setOpen(false);
    setActiveIndex(-1);
    setState({ status: "idle" });
  }, [pathname, routeQuery]);

  useEffect(() => {
    if (!open || query.length < 2 || vin) return;
    setState({ status: "loading" });
    setActiveIndex(-1);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ limit: String(SUGGESTION_LIMIT), q: query });
      fetch(`/api/v1/catalog/products?${params.toString()}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      })
        .then(async response => {
          if (!response.ok) throw new Error("Catalog unavailable");
          return CatalogProductsResponseSchema.parse(await response.json());
        })
        .then(({ items, total }) => {
          if (controller.signal.aborted) return;
          setState(items.length ? { status: "ready", items, total } : { status: "empty" });
        })
        .catch(() => { if (!controller.signal.aborted) setState({ status: "error" }); });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, vin]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const panel = panelRef.current;
    if (!compact || !showPanel || !viewport || !panel) return;
    let frame = 0;
    const measure = () => {
      const visibleBottom = viewport.offsetTop + viewport.height;
      panel.style.setProperty("--search-available-height", `${Math.max(48, Math.floor(visibleBottom - panel.getBoundingClientRect().top - 12))}px`);
    };
    function schedule() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    }
    measure();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      window.removeEventListener("scroll", schedule);
    };
  }, [compact, showPanel]);

  function navigateResult() {
    rememberCatalogSearch(query);
    setHistory(readRecentCatalogSearches());
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && items.length) {
      event.preventDefault();
      const next = event.key === "ArrowDown" ? (activeIndex + 1) % items.length : activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
      setOpen(true);
      setActiveIndex(next);
      const item = items[next];
      if (item) document.getElementById(`${id}-option-${item.id}`)?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Escape" && showPanel) {
      event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
    } else if (event.key === "Enter" && showPanel && items[activeIndex]) {
      event.preventDefault();
      navigateResult();
      router.push(`/catalog/product/${encodeURIComponent(items[activeIndex].slug)}`);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    if (query.length < 2) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    if (vin) {
      setOpen(false);
      try { window.sessionStorage.setItem(EXPERT_HELP_VIN_STORAGE_KEY, query.toUpperCase()); } catch { /* The form still opens. */ }
      router.push(`/podbor?vin=${encodeURIComponent(query.toUpperCase())}`);
      return;
    }
    navigateResult();
    // "аккумулятор" names a section: open it rather than a word search.
    const section = categories ? exactCategoryMatch(categories, query) : null;
    const sectionHref = section && categories ? categoryHrefBySlug(categories, section.slug) : null;
    if (sectionHref) {
      router.push(sectionHref);
      return;
    }
    void routeByResolve(query);
  }

  // One search pipeline: a chassis number opens the VIN decoder, a part number
  // or «деталь + машина» opens /podbor (our stock, own crosses, then supplier
  // offers or the guided steps); anything else stays a catalog search.
  async function routeByResolve(text: string) {
    try {
      const response = await fetch("/api/v1/parts-finder/resolve", {
        body: JSON.stringify({ query: text.slice(0, 140), supplier: false }),
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(2_500),
      });
      if (response.ok) {
        const data = await response.json() as { kind?: unknown };
        if (data.kind === "vin") {
          router.push(`/podbor?vin=${encodeURIComponent(text.toUpperCase())}`);
          return;
        }
        if (data.kind === "article" || data.kind === "vehicle_part") {
          router.push(`/podbor?q=${encodeURIComponent(text)}&from=header`);
          return;
        }
      }
    } catch {
      // Slow or unavailable: the catalog search below still answers.
    }
    router.push(`${catalogSearchHref(text)}&direct=1`);
  }

  return (
    <div className={styles.searchBox} ref={rootRef} onBlur={event => {
      // Safari can clear focus before a touch activates a suggestion, and also
      // when the keyboard is dismissed. The outside pointer handler covers taps away.
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
    }}>
      <form action="/catalog" autoComplete="off" className={styles.searchForm} method="get" onSubmit={submit} role="search">
        <label className={styles.visuallyHidden} htmlFor={id}>Поиск по VIN, названию или артикулу</label>
        <Search20Regular aria-hidden="true" />
        <input
          aria-activedescendant={showPanel && items[activeIndex] ? `${id}-option-${items[activeIndex].id}` : undefined}
          aria-autocomplete="list"
          aria-controls={showPanel ? (state.status === "ready" && !showHistory ? listboxId : popupId) : undefined}
          aria-expanded={showPanel}
          aria-haspopup={state.status === "ready" && !showHistory ? "listbox" : "dialog"}
          id={id}
          maxLength={120}
          minLength={2}
          name="q"
          onChange={event => {
            setValue(event.target.value);
            if (!event.target.value.trim()) setHistory(readRecentCatalogSearches());
            setState({ status: "idle" });
            setActiveIndex(-1);
            setOpen(true);
          }}
          onBlur={() => setFocused(false)}
          onFocus={() => { setFocused(true); setHistory(readRecentCatalogSearches()); setOpen(true); }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          required
          role="combobox"
          type="search"
          value={value}
        />
        <button aria-label="Найти в каталоге" type="submit">Найти</button>
      </form>
      <Link className={styles.searchAssist} href="/podbor">
        <span className={styles.searchAssistText}>
          <strong>Подбор по VIN</strong>
          <small>или по марке и модели</small>
          <span aria-hidden="true" className={styles.searchAssistAction}>Подобрать <ChevronRight16Regular /></span>
        </span>
        <img alt="" className={styles.searchAssistCar} height={111} src="/brand/car-an30-banner@2x.webp" srcSet="/brand/car-an30-banner@2x.webp 2x, /brand/car-an30-banner@3x.webp 3x" width={180} />
      </Link>
      {showPanel ? (
        <div aria-label={showStart ? (showHistory ? "Недавние запросы" : "С чего начать поиск") : "Подсказки поиска"}
          className={styles.searchSuggestions} id={popupId} ref={panelRef} role={state.status === "ready" && !showHistory ? "group" : "dialog"}>
          {showStart ? (
            <>
              {showHistory ? (
                <>
                  <div className={styles.searchRecentHead}>
                    <strong>Недавние запросы</strong>
                    <button type="button" onClick={() => { clearRecentCatalogSearches(); setHistory([]); document.getElementById(id)?.focus(); }}>Очистить</button>
                  </div>
                  {history.map(previous => <Link className={styles.searchExtraLink} href={catalogSearchHref(previous)} key={previous} onClick={() => setOpen(false)}><Clock20Regular aria-hidden="true" />{previous}</Link>)}
                </>
              ) : (
                <p className={styles.searchStartHint}>Ищите по артикулу, названию детали или бренду. VIN из 17 символов откроет подбор у специалиста.</p>
              )}
              <div className={styles.searchSectionBlock}>
                <strong>Популярные разделы</strong>
                <div className={styles.searchChips}>
                  {popularSections.map(({ key, label }) => (
                    <Link className={styles.searchChip} href={(categories && categoryHrefBySlug(categories, key)) ?? `/catalog/${key}`} key={key} onClick={() => setOpen(false)}>{label}</Link>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              {sectionMatches.length ? (
                <div className={styles.searchSectionBlock}>
                  <strong>Разделы каталога</strong>
                  {sectionMatches.map((section) => (
                    <Link className={styles.searchSectionLink} href={section.href} key={section.href} onClick={navigateResult}>
                      <span><Highlighted query={query} text={section.name} />{section.parentName ? <small>{section.parentName}</small> : null}</span>
                      <span className={styles.searchSectionCount}>{section.productCount}</span>
                    </Link>
                  ))}
                </div>
              ) : null}
              {serviceLinks.length ? <div className={styles.searchExtra}>
                <strong>Информация магазина</strong>
                {serviceLinks.map(({ href, label }) => <Link className={styles.searchExtraLink} href={href} key={href} onClick={navigateResult}>{label}</Link>)}
              </div> : null}
              {state.status === "loading" ? <p className={styles.searchSuggestionStatus} role="status">Ищем в каталоге…</p> : null}
              {state.status === "error" ? <p className={styles.searchSuggestionStatus} role="status">Подсказки недоступны. Поиск можно запустить кнопкой «Найти».</p> : null}
              {state.status === "empty" ? (
                <div className={styles.searchSuggestionEmpty}>
                  <p className={styles.searchEmptyTitle} role="status">По запросу «{query}» ничего не нашлось</p>
                  {layoutHint ? (
                    <p className={styles.searchLayoutHint}>
                      Возможно, вы имели в виду{" "}
                      <button type="button" onClick={() => { setValue(layoutHint); setOpen(true); document.getElementById(id)?.focus(); }}>{layoutHint}</button>
                    </p>
                  ) : <p className={styles.searchEmptyText}>Проверьте написание или поищите по артикулу. Нужную деталь найдёт и привезёт специалист.</p>}
                  {categoryLinks.length ? (
                    <div className={styles.searchChips}>
                      {categoryLinks.map(({ href, label }) => <Link className={styles.searchChip} href={href} key={href} onClick={navigateResult}>{label}</Link>)}
                    </div>
                  ) : null}
                  <ExpertHelpQueryLink className={styles.searchSuggestionHelp} query={query}>Спросить специалиста</ExpertHelpQueryLink>
                </div>
              ) : null}
              {state.status === "ready" ? (
                <div aria-label="Найденные детали" className={styles.searchSuggestionList} id={listboxId} role="listbox">
                  {state.items.map((item, index) => (
                    <Link
                      aria-selected={index === activeIndex}
                      className={styles.searchSuggestion}
                      data-active={index === activeIndex || undefined}
                      href={`/catalog/product/${encodeURIComponent(item.slug)}`}
                      id={`${id}-option-${item.id}`}
                      key={item.id}
                      onClick={navigateResult}
                      onMouseEnter={() => setActiveIndex(index)}
                      role="option"
                    >
                      <span className={styles.searchSuggestionFigure}>
                        <CatalogPhoto className={styles.searchSuggestionMedia} sizes="42px" src={item.primaryImage?.url}
                          showNote={false} categoryImage={catalogCategoryPhoto(item.category)} />
                      </span>
                      <span className={styles.searchSuggestionIdentity}>
                        <span className={styles.searchSuggestionName}><Highlighted query={query} text={item.name} /></span>
                        <span className={styles.searchSuggestionMeta}>{item.brand ? `${item.brand.name} · ` : ""}<Highlighted query={query} text={item.sku} /></span>
                      </span>
                      <span className={styles.searchSuggestionPrice}>
                        {item.priceKopeks === null ? "Цена уточняется" : formatRubles(item.priceKopeks)}
                        <small data-in-stock={item.availableQuantity > 0 || undefined}>{item.availableQuantity > 0 ? "В наличии" : "Под заказ"}</small>
                      </span>
                    </Link>
                  ))}
                </div>
              ) : null}
              <Link className={styles.searchSuggestionAll} href={catalogSearchHref(query)} onClick={navigateResult}>
                {state.status === "ready" ? `Показать все результаты · ${state.total}` : "Открыть результаты поиска"}
              </Link>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
