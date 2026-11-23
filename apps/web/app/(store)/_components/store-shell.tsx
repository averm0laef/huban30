"use client";

import {
  Call20Regular, Cart24Regular, Chat24Regular, Clock20Regular, Grid24Regular,
  Home24Regular, Location20Regular, Person24Regular, VehicleCar24Regular,
} from "@fluentui/react-icons";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FocusEvent, ReactNode } from "react";

import {
  MESSENGERS,
  SITE_LEGAL_NAME,
  STORE_HOURS,
  STORE_LOCALITY,
  STORE_MAP_URL,
  STORE_PHONE,
  STORE_PHONE_DISPLAY,
  STORE_STREET,
} from "../../site-config";
import { sectionLink, type CatalogMenuSection } from "../_lib/store-categories";
import { BrandLockup } from "./brand-mark";
import { CartButton } from "./cart-actions";
import { CartProvider } from "./cart-provider";
import { CatalogMenu } from "./catalog-menu";
import { ChatWidget } from "./chat-widget";
import { createHeaderCollapseState, getNextHeaderCollapseState } from "./header-scroll-collapse";
import { HeaderVehicle } from "./header-vehicle";
import { CompactMenuButton, MobileStoreMenu } from "./mobile-store-menu";
import { HeaderSearchForm } from "./search-box";
import { AccountNavigation, SessionNavigationProvider, useAccountDestination } from "./session-navigation";
import { MessengerIcon } from "./messenger-icon";
import { StoreHeaderMenu } from "./store-header-menu";
import buttons from "./store-button.module.css";
import styles from "./storefront.module.css";

const STORE_PHONE_HREF = `tel:${STORE_PHONE}`;
// CSS uses `--store-duration-slow: 320ms`; the small buffer lets scroll
// anchoring finish before direction sampling resumes.
const HEADER_LAYOUT_SETTLE_MS = 360;

const customerLinks = [
  { href: "/how-to-order", label: "Как сделать заказ", description: "От корзины до получения" },
  { href: "/delivery", label: "Доставка и самовывоз", description: "Как и где забрать заказ" },
  { href: "/returns", label: "Возврат и обмен", description: "Сроки и порядок возврата" },
  { href: "/warranty", label: "Гарантия", description: "Что делать, если у товара есть недостаток" },
  { href: "/terms", label: "Условия работы", description: "Оферта и правила магазина" },
  { href: "/privacy", label: "Конфиденциальность", description: "Как мы обрабатываем данные" },
];

const companyLinks = [
  { href: "/about", label: "О компании", description: "О магазине АН-30" },
  { href: "/contacts", label: "Контакты", description: "Телефон, чат и мессенджеры" },
  { href: "/map", label: "Адрес магазина", description: "График работы и маршрут" },
  { href: "/careers", label: "Вакансии", description: "Работа в АН-30" },
];

/**
 * Real brand glyphs (monochrome, `currentColor`) instead of the previous
 * paper-plane/bubble/literal-text placeholders. Telegram, WhatsApp and VK
 * use the marks' official outlines; MAX (VK's 2025 messenger) has no
 * established icon-set glyph yet, so its badge+mark shape is redrawn from
 * the brand's own published logo.
 */

// Keep search available while the surrounding navigation collapses on scroll.
function StoreHeader({ catalogMenu }: { catalogMenu: CatalogMenuSection[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const collapseStateRef = useRef(createHeaderCollapseState());
  const focusWithinCollapsibleContentRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);
  const layoutSettleTimerRef = useRef<number | null>(null);
  const layoutSettlingRef = useRef(false);

  const updateCollapseState = useCallback((scrollY: number, force = false) => {
    // Collapsing a sticky element changes its document height. Browsers then
    // adjust scrollY to preserve the reading position; that synthetic upward
    // delta must not be mistaken for a visitor asking to reveal the header.
    // Focus and motion-preference changes bypass the lock for accessibility.
    if (layoutSettlingRef.current && !force) return;

    const previous = collapseStateRef.current;
    const next = getNextHeaderCollapseState(previous, {
      focusWithinCollapsibleContent: focusWithinCollapsibleContentRef.current,
      reducedMotion: reducedMotionRef.current,
      scrollY,
    });
    collapseStateRef.current = next;

    // Scroll samples update refs only. React renders solely when visibility
    // actually changes, rather than once per scroll frame.
    if (next.collapsed !== previous.collapsed) {
      setCollapsed(next.collapsed);
      layoutSettlingRef.current = true;
      if (layoutSettleTimerRef.current !== null) window.clearTimeout(layoutSettleTimerRef.current);
      layoutSettleTimerRef.current = window.setTimeout(() => {
        layoutSettleTimerRef.current = null;
        layoutSettlingRef.current = false;
        collapseStateRef.current = {
          ...collapseStateRef.current,
          anchorScrollY: Math.max(0, window.scrollY),
        };
      }, HEADER_LAYOUT_SETTLE_MS);
    }
  }, []);

  // A new page starts with the full header and a fresh scroll anchor.
  const pathname = usePathname();
  useEffect(() => {
    focusWithinCollapsibleContentRef.current = false;
    layoutSettlingRef.current = false;
    collapseStateRef.current = createHeaderCollapseState(window.scrollY);
    setCollapsed(false);
  }, [pathname]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = query.matches;
    collapseStateRef.current = createHeaderCollapseState(window.scrollY);
    layoutSettlingRef.current = false;

    const onScroll = () => {
      if (animationFrameRef.current !== null) return;
      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null;
        updateCollapseState(window.scrollY);
      });
    };

    const onMotionPreferenceChange = (event: MediaQueryListEvent) => {
      reducedMotionRef.current = event.matches;
      updateCollapseState(window.scrollY, true);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    query.addEventListener("change", onMotionPreferenceChange);
    return () => {
      window.removeEventListener("scroll", onScroll);
      query.removeEventListener("change", onMotionPreferenceChange);
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (layoutSettleTimerRef.current !== null) {
        window.clearTimeout(layoutSettleTimerRef.current);
        layoutSettleTimerRef.current = null;
      }
      layoutSettlingRef.current = false;
    };
  }, [updateCollapseState]);

  function handleFocus(event: FocusEvent<HTMLDivElement>) {
    const target = event.target as Element;
    // Only keyboard focus pins the header open. A tap or click also focuses
    // the link/button, and because the header survives client navigation
    // that focus used to stay put on the next page — the header then never
    // collapsed again until the visitor clicked somewhere else.
    const keyboardFocus = target.matches(":focus-visible");
    focusWithinCollapsibleContentRef.current = keyboardFocus && !target.closest("[data-header-persistent-search]");
    updateCollapseState(window.scrollY, true);
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      focusWithinCollapsibleContentRef.current = false;
      updateCollapseState(window.scrollY, true);
    }
  }

  return (
    <header className={styles.header}>
      <div
        className={styles.headerInset}
        data-collapsed={collapsed ? "true" : undefined}
        onFocus={handleFocus}
        onBlur={handleBlur}
      >
        <div className={styles.headerMainRow}>
          <div className={styles.headerRowInner}>
            <MobileStoreMenu catalogMenu={catalogMenu} />
            <Link className={styles.brand} href="/" aria-label={`${SITE_LEGAL_NAME}, на главную`}>
              <BrandLockup className={styles.brandLockup} />
            </Link>
            <CatalogMenu key={`catalog:${pathname}:${collapsed}`} sections={catalogMenu} />
            <div className={styles.headerDesktopSearch} data-header-persistent-search>
              <HeaderSearchForm id="header-search-q" />
            </div>
            <div className={styles.headerActions}>
              <HeaderVehicle icon={<VehicleCar24Regular aria-hidden="true" />} />
              <CartButton icon={<Cart24Regular aria-hidden="true" />} />
              <AccountNavigation icon={<Person24Regular aria-hidden="true" />} />
            </div>
            <div className={styles.mobileHeaderActions}>
              <a href="/map" aria-label={`Магазин на карте: ${STORE_LOCALITY}, ${STORE_STREET}`}>
                <Location20Regular aria-hidden="true" />
              </a>
              <a href={STORE_PHONE_HREF} aria-label={`Позвонить в магазин: ${STORE_PHONE_DISPLAY}`}>
                <Call20Regular aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>

        <div className={styles.headerTopRow}>
          <div className={styles.headerRowInner}>
            <a className={styles.headerTopLocation} href={STORE_MAP_URL} target="_blank" rel="noreferrer">
              <Location20Regular aria-hidden="true" /> <span>{STORE_LOCALITY}, {STORE_STREET}</span>
            </a>
            <nav className={styles.headerTopLinks} aria-label="Разделы магазина">
              <Link href="/podbor">Подбор по авто</Link>
              <StoreHeaderMenu key={`customers:${pathname}:${collapsed}`} help label="Покупателям" links={customerLinks} />
              <StoreHeaderMenu key={`company:${pathname}:${collapsed}`} label="Компания" links={companyLinks} />
              <Link href="/contacts">Контакты</Link>
            </nav>
            <div className={styles.headerTopRight}>
              <a className={styles.headerTopPhone} href={STORE_PHONE_HREF}>
                <Call20Regular aria-hidden="true" /> <span>{STORE_PHONE_DISPLAY}</span>
              </a>
              <div className={styles.headerMessengers}>
                {MESSENGERS.map((messenger) => (
                  <a
                    key={messenger.id}
                    className={styles.headerMessengerLink}
                    href={messenger.href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={messenger.label}
                    title={messenger.label}
                  >
                    <MessengerIcon id={messenger.id} />
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Mobile row 2: the search field alone, full width. */}
        <div className={styles.mobileSearchRow} data-header-persistent-search>
          <div className={styles.headerRowInner}>
            <CompactMenuButton />
            <HeaderSearchForm id="header-search-q-mobile" compact />
          </div>
        </div>

      </div>
    </header>
  );
}

/** Sections the footer names. Each opens its page when the catalogue holds it, a search by its word when not. */
const footerSections = [
  { key: "motornye-masla", label: "Моторные масла" },
  { key: "filtry", label: "Фильтры" },
  { key: "tormoznaya-sistema", label: "Тормозная система" },
];
const footerHelpLinks = [
  { href: "/podbor", label: "Подбор по марке и VIN" },
  { href: "/expert-help", label: "Помощь специалиста" },
  { href: "/chat", label: "Чат с магазином" },
];

/** «Подвал v2» from the design canvas: one ink-indigo block, phone first. */
function StoreFooter({ catalogMenu }: { catalogMenu: CatalogMenuSection[] }) {
  return (
    <footer className={styles.footerV2}>
      <div className={styles.footerV2Inner}>
        <div className={styles.footerV2Top}>
          <div className={styles.footerV2Brand}>
            <Link href="/" aria-label={SITE_LEGAL_NAME}><BrandLockup className={styles.footerV2Logo} tone="current" /></Link>
            <p>Автозапчасти для легковых и грузовых автомобилей. Подбор по VIN и самовывоз в {STORE_LOCALITY === "Чернышевск" ? "Чернышевске" : STORE_LOCALITY}.</p>
          </div>
          <div className={styles.footerV2Contact}>
            <a className={styles.footerV2Phone} href={STORE_PHONE_HREF}><Call20Regular aria-hidden="true" />{STORE_PHONE_DISPLAY}</a>
            <span><Clock20Regular aria-hidden="true" />{STORE_HOURS} · <Location20Regular aria-hidden="true" />{STORE_STREET}</span>
            <div className={styles.footerV2Channels}>
              {MESSENGERS.map((messenger) => (
                <a aria-label={messenger.label} href={messenger.href} key={messenger.id} rel="noreferrer" target="_blank">
                  <MessengerIcon id={messenger.id} /><span>{messenger.label}</span>
                </a>
              ))}
              <Link className={`${styles.footerV2Chat} ${buttons.button} ${buttons.accent}`} href="/chat">Написать в чат</Link>
            </div>
          </div>
        </div>
        <nav aria-label="Разделы сайта" className={styles.footerV2Nav}>
          <div>
            <h2>Каталог</h2>
            {footerSections.map((section) => <Link href={sectionLink(catalogMenu, section.key)} key={section.key}>{section.label}</Link>)}
            <Link href="/catalog">Весь каталог</Link>
          </div>
          <div><h2>Покупателям</h2>{customerLinks.slice(0, 4).map((link) => <Link href={link.href} key={link.href}>{link.label}</Link>)}</div>
          <div><h2>Подбор</h2>{footerHelpLinks.map((link) => <Link href={link.href} key={link.href}>{link.label}</Link>)}</div>
          <div><h2>Компания</h2>{companyLinks.map((link) => <Link href={link.href} key={link.href}>{link.label}</Link>)}</div>
        </nav>
        <div className={styles.footerV2Legal}>
          <span>© {new Date().getFullYear()} ИП Ермолаева М. Ю. · ОГРНИП 315751300001899 · Магазин автозапчастей «АН-30»</span>
          <span><Link href="/terms">Условия работы</Link><Link href="/privacy">Политика конфиденциальности</Link></span>
        </div>
      </div>
    </footer>
  );
}

function MobileNavigation() {
  const pathname = usePathname() ?? "/";
  const accountDestination = useAccountDestination();
  const accountPath = accountDestination.href.split("?")[0];
  const isHome = pathname === "/";
  const isCatalog = pathname === "/catalog" || pathname.startsWith("/catalog/");
  const isChat = pathname === "/chat" || pathname.startsWith("/chat/");
  const isAccount = pathname === accountPath || pathname.startsWith(`${accountPath}/`);

  return (
    <nav className={styles.mobileNav} aria-label="Быстрая навигация">
      <Link className={styles.mobileNavItem} href="/" aria-current={isHome ? "page" : undefined}><Home24Regular aria-hidden="true" /><span>Главная</span></Link>
      <Link className={styles.mobileNavItem} href="/catalog" aria-current={isCatalog ? "page" : undefined}><Grid24Regular aria-hidden="true" /><span>Каталог</span></Link>
      <CartButton className={styles.mobileNavItem} icon={<Cart24Regular aria-hidden="true" />} />
      <Link className={styles.mobileNavItem} href="/chat" aria-current={isChat ? "page" : undefined}><Chat24Regular aria-hidden="true" /><span>Чат</span></Link>
      <AccountNavigation className={styles.mobileNavItem} icon={<Person24Regular aria-hidden="true" />} isCurrent={isAccount} />
    </nav>
  );
}

export function StoreShell({ catalogMenu, children, initialSessionPresent }: {
  catalogMenu: CatalogMenuSection[];
  children: ReactNode;
  initialSessionPresent: boolean;
}) {
  return (
    <SessionNavigationProvider initialSessionPresent={initialSessionPresent}>
      <CartProvider>
        <div className={styles.storefront} data-storefront-root>
          <a className={styles.skipLink} href="#main-content">Перейти к содержанию</a>
          <StoreHeader catalogMenu={catalogMenu} />
          <main className={styles.main} id="main-content">{children}</main>
          <StoreFooter catalogMenu={catalogMenu} />
          <MobileNavigation />
          {/* Outside the tab bar: the round button floats over the page at every width. */}
          <ChatWidget />
        </div>
      </CartProvider>
    </SessionNavigationProvider>
  );
}
