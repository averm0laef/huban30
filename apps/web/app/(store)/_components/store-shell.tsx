"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
import type { MessengerLink } from "../../site-config";
import { BrandLockup } from "./brand-mark";
import { CartButton, CartPanel, MobileCartButton } from "./cart-actions";
import { CartProvider } from "./cart-provider";
import { isHeaderCollapsed } from "./header-scroll-collapse";
import { HeaderSearchForm } from "./search-box";
import { AccountNavigation, SessionNavigationProvider, useAccountDestination } from "./session-navigation";
import styles from "./storefront.module.css";

const STORE_PHONE_HREF = `tel:${STORE_PHONE}`;

const customerLinks = [
  { href: "/delivery", label: "Условия доставки" },
  { href: "/returns", label: "Возврат товара" },
  { href: "/how-to-order", label: "Как сделать заказ" },
  { href: "/terms", label: "Условия работы для клиентов" },
  { href: "/privacy", label: "Политика конфиденциальности" },
];

const companyLinks = [
  { href: "/about", label: "О компании" },
  { href: "/contacts", label: "Контакты" },
  { href: "/map", label: "Адрес магазина" },
  { href: "/careers", label: "Вакансии" },
];

function GridIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function HeadsetIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
      <rect x="3" y="13" width="4" height="6" rx="1.5" />
      <rect x="17" y="13" width="4" height="6" rx="1.5" />
      <path d="M19 19v1a3 3 0 0 1-3 3h-2" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 4h3.2l1.6 4.5-2.1 1.6a11.5 11.5 0 0 0 5.7 5.7l1.6-2.1 4.5 1.6v3.2a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 4 5.6 1.5 1.5 0 0 1 5.5 4Z" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s7-6.7 7-12.2A7 7 0 0 0 5 8.8C5 14.3 12 21 12 21Z" />
      <circle cx="12" cy="8.8" r="2.4" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4h2l2.4 12.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 8H6" />
      <circle cx="9.5" cy="20.5" r="1.4" />
      <circle cx="17.5" cy="20.5" r="1.4" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20c1.4-3.8 4.4-5.8 7.5-5.8s6.1 2 7.5 5.8" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v9h12v-9" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h16v11H8l-4 4V5Z" />
    </svg>
  );
}

/**
 * Real brand glyphs (monochrome, `currentColor`) instead of the previous
 * paper-plane/bubble/literal-text placeholders. Telegram, WhatsApp and VK
 * use the marks' official outlines; MAX (VK's 2025 messenger) has no
 * established icon-set glyph yet, so its badge+mark shape is redrawn from
 * the brand's own published logo.
 */
function MessengerIcon({ id }: { id: MessengerLink["id"] }) {
  if (id === "telegram") {
    return (
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
      </svg>
    );
  }
  if (id === "whatsapp") {
    return (
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
      </svg>
    );
  }
  if (id === "vk") {
    return (
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="m9.489.004.729-.003h3.564l.73.003.914.01.433.007.418.011.403.014.388.016.374.021.36.025.345.03.333.033c1.74.196 2.933.616 3.833 1.516.9.9 1.32 2.092 1.516 3.833l.034.333.029.346.025.36.02.373.025.588.012.41.013.644.009.915.004.98-.001 3.313-.003.73-.01.914-.007.433-.011.418-.014.403-.016.388-.021.374-.025.36-.03.345-.033.333c-.196 1.74-.616 2.933-1.516 3.833-.9.9-2.092 1.32-3.833 1.516l-.333.034-.346.029-.36.025-.373.02-.588.025-.41.012-.644.013-.915.009-.98.004-3.313-.001-.73-.003-.914-.01-.433-.007-.418-.011-.403-.014-.388-.016-.374-.021-.36-.025-.345-.03-.333-.033c-1.74-.196-2.933-.616-3.833-1.516-.9-.9-1.32-2.092-1.516-3.833l-.034-.333-.029-.346-.025-.36-.02-.373-.025-.588-.012-.41-.013-.644-.009-.915-.004-.98.001-3.313.003-.73.01-.914.007-.433.011-.418.014-.403.016-.388.021-.374.025-.36.03-.345.033-.333c.196-1.74.616-2.933 1.516-3.833.9-.9 2.092-1.32 3.833-1.516l.333-.034.346-.029.36-.025.373-.02.588-.025.41-.012.644-.013.915-.009ZM6.79 7.3H4.05c.13 6.24 3.25 9.99 8.72 9.99h.31v-3.57c2.01.2 3.53 1.67 4.14 3.57h2.84c-.78-2.84-2.83-4.41-4.11-5.01 1.28-.74 3.08-2.54 3.51-4.98h-2.58c-.56 1.98-2.22 3.78-3.8 3.95V7.3H10.5v6.92c-1.6-.4-3.62-2.34-3.71-6.92Z" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 1000 1000" fill="none">
      <rect x="40" y="40" width="920" height="920" rx="230" stroke="currentColor" strokeWidth="70" />
      <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M508.211 878.328c-75.007 0-109.864-10.95-170.453-54.75-38.325 49.275-159.686 87.783-164.979 21.9 0-49.456-10.95-91.248-23.36-136.873-14.782-56.21-31.572-118.807-31.572-209.508 0-216.626 177.754-379.597 388.357-379.597 210.785 0 375.947 171.001 375.947 381.604.707 207.346-166.595 376.118-373.94 377.224m3.103-571.585c-102.564-5.292-182.499 65.7-200.201 177.024-14.6 92.162 11.315 204.398 33.397 210.238 10.585 2.555 37.23-18.98 53.837-35.587a189.8 189.8 0 0 0 92.71 33.032c106.273 5.112 197.08-75.794 204.215-181.95 4.154-106.382-77.67-196.486-183.958-202.574Z" />
    </svg>
  );
}

/**
 * A single ink-blue panel (`.headerInset`), inset from the viewport edges
 * with rounded bottom corners — the rossko.ru reference's "по бокам
 * дизайн" — holding the reference's row structure. Which rows render is
 * driven entirely by CSS display toggles at the 768px boundary (the same
 * boundary the bottom tab bar in `MobileNavigation` uses), not by two
 * separate component trees, so cart/account state stays in sync everywhere
 * it appears:
 *
 * Desktop (≥768px), two rows, unchanged by the mobile work below:
 *  - `.headerTopRow` — thin utility line: shop address (links to the map),
 *    hours, the secondary links, then the help phone number and messenger
 *    icons pinned right.
 *  - `.headerMainRow` — brand lockup, the wide rounded search field
 *    (`.headerDesktopSearch`), and the cart/account actions.
 *
 * Mobile (<768px), five rows per the owner's reference walkthrough:
 *  1. `.mobileLinksRow` — "О компании" / "Контакты", left aligned.
 *  2. `.headerMainRow` again, but showing brand + `.mobileHeaderActions`
 *     (just the phone now — see below) instead of the desktop search +
 *     actions.
 *  3. `.mobileLocationRow` — a pin + "Чернышевск" on the left, a link to
 *     the shop's street address on the right.
 *  4. `.mobileSearchRow` — the same pill search field alone on its own row
 *     ("строка с поиском отдельно").
 *  5. `.mobileExpertRow` — the single accent CTA to /expert-help.
 *
 * There is no separate "Каталог" button in either desktop row: the
 * reference reaches the catalog from the search field, the category tiles,
 * and — on a phone — the bottom tab bar.
 *
 * Cart and account dropped off the mobile panel (the owner's "убери
 * корзину и аккаунт" ask) because `MobileNavigation`'s fixed bottom tab
 * bar already carries both — same `<768px` breakpoint, so there is no
 * width where either becomes unreachable.
 *
 * Scroll collapse (mobile only): past `HEADER_COLLAPSE_SCROLL_THRESHOLD_PX`
 * every row but the search field collapses to nothing via the CSS
 * grid-rows trick (`data-collapsed` below drives the `[data-collapsed]`
 * selectors in storefront.module.css), leaving just the pinned search bar —
 * see header-scroll-collapse.ts for why this needed a scroll listener
 * instead of being pure CSS, and for the focus/reduced-motion guards.
 */
function StoreHeader() {
  const [scrollY, setScrollY] = useState(0);
  const [focusWithin, setFocusWithin] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const tickingRef = useRef(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const onScroll = () => {
      if (tickingRef.current) return;
      tickingRef.current = true;
      window.requestAnimationFrame(() => {
        setScrollY(window.scrollY);
        tickingRef.current = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const collapsed = isHeaderCollapsed({ focusWithin, reducedMotion, scrollY });

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusWithin(false);
  }

  return (
    <header className={styles.header}>
      <div
        className={styles.headerInset}
        data-collapsed={collapsed ? "true" : undefined}
        onFocus={() => setFocusWithin(true)}
        onBlur={handleBlur}
      >
        {/* Desktop row 1 (thin utility line). */}
        <div className={styles.headerTopRow}>
          <div className={styles.headerRowInner}>
            <a className={styles.headerTopLocation} href={STORE_MAP_URL} target="_blank" rel="noreferrer">
              <PinIcon /> <span>{STORE_LOCALITY}, {STORE_STREET}</span>
            </a>
            <span className={styles.headerTopHours}>
              <ClockIcon /> <span>{STORE_HOURS}</span>
            </span>
            <nav className={styles.headerTopLinks} aria-label="Дополнительные ссылки">
              <Link href="/about">О компании</Link>
              <Link href="/contacts">Контакты</Link>
            </nav>
            <div className={styles.headerTopRight}>
              <a className={styles.headerTopPhone} href={STORE_PHONE_HREF}>
                <PhoneIcon /> <span>{STORE_PHONE_DISPLAY}</span>
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

        {/* Mobile row 1: two secondary links, left aligned. */}
        <div className={styles.mobileLinksRow}>
          <div className={styles.headerRowInner}>
            <nav className={styles.headerTopLinks} aria-label="Дополнительные ссылки">
              <Link href="/about">О компании</Link>
              <Link href="/contacts">Контакты</Link>
            </nav>
          </div>
        </div>

        {/* Row 2 everywhere: brand on the left; desktop search + actions,
            or (mobile) the phone/cart/account icon cluster, on the right. */}
        <div className={styles.headerMainRow}>
          <div className={styles.headerRowInner}>
            <Link className={styles.brand} href="/" aria-label={`${SITE_LEGAL_NAME}, на главную`}>
              <BrandLockup className={styles.brandLockup} tone="current" />
            </Link>
            <div className={styles.headerDesktopSearch}>
              <HeaderSearchForm id="header-search-q" />
            </div>
            <div className={styles.headerActions}>
              <CartButton icon={<CartIcon />} />
              <AccountNavigation icon={<UserIcon />} />
            </div>
            <div className={styles.mobileHeaderActions}>
              {/* Cart and account live on the fixed bottom tab bar only
                  below 768px (see `MobileNavigation`) — kept off this
                  panel so it has one job (call the shop) instead of
                  duplicating controls that are always one thumb-reach
                  away regardless of scroll position. */}
              <a href={STORE_PHONE_HREF} aria-label={`Позвонить в магазин: ${STORE_PHONE_DISPLAY}`}>
                <PhoneIcon />
              </a>
            </div>
          </div>
        </div>

        {/* Mobile row 3: locality on the left, a link to the street address
            on the right. */}
        <div className={styles.mobileLocationRow}>
          <div className={styles.headerRowInner}>
            <span className={styles.mobileLocationText}>
              <PinIcon /> <span>{STORE_LOCALITY}</span>
            </span>
            <a className={styles.mobileAddressLink} href={STORE_MAP_URL} target="_blank" rel="noreferrer">
              {STORE_STREET}
            </a>
          </div>
        </div>

        {/* Mobile row 4: the search field alone, full width. */}
        <div className={styles.mobileSearchRow}>
          <div className={styles.headerRowInner}>
            <HeaderSearchForm id="header-search-q-mobile" />
          </div>
        </div>

        {/* Mobile row 5: the single accent CTA. */}
        <div className={styles.mobileExpertRow}>
          <div className={styles.headerRowInner}>
            <Link className={styles.mobileExpertButton} href="/expert-help">Подбор с экспертом</Link>
          </div>
        </div>
      </div>
    </header>
  );
}

function StoreFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerGrid}>
        <section aria-labelledby="footer-store">
          <div className={styles.footerBrand}>
            <BrandLockup className={styles.footerWordmark} tone="current" />
            {/* BrandLockup's own <svg> is aria-hidden (it is a logotype
                rendering of this exact name), so the section still needs a
                real accessible name — visually hidden, not removed. */}
            <h2 className={styles.visuallyHidden} id="footer-store">{SITE_LEGAL_NAME}</h2>
          </div>
          <p>Автозапчасти для легковых и грузовых автомобилей в {STORE_LOCALITY}. Цены и остатки — из 1С, самовывоз из магазина.</p>
          <ul className={styles.footerContactList}>
            <li><PhoneIcon /><a href={STORE_PHONE_HREF}>{STORE_PHONE_DISPLAY}</a></li>
            <li><PinIcon /><span>{STORE_LOCALITY}, {STORE_STREET}</span></li>
            <li><ClockIcon /><span>{STORE_HOURS}</span></li>
          </ul>
        </section>
        <nav aria-label="Покупателям">
          <h2>Покупателям</h2>
          {customerLinks.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
        </nav>
        <nav aria-label="О компании">
          <h2>Компания</h2>
          {companyLinks.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
          <Link href="/chat">Чат с магазином</Link>
        </nav>
        <section aria-labelledby="footer-contact">
          <h2 id="footer-contact">Мессенджеры</h2>
          <div className={styles.footerMessengers}>
            {MESSENGERS.map((messenger) => (
              <a
                key={messenger.id}
                className={styles.footerMessengerLink}
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
        </section>
      </div>
      <div className={styles.legal}>© {new Date().getFullYear()} ИП Ермолаева М.Ю. Магазин автозапчастей «АН-30».</div>
    </footer>
  );
}

/**
 * Fixed bottom tab bar (<768px, see `.mobileNav`). The current route is
 * marked with `aria-current="page"` on whichever tab is an actual page —
 * Cart has no route of its own (it opens a dialog), so it is deliberately
 * left out of that check.
 */
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
      <Link className={styles.mobileNavItem} href="/" aria-current={isHome ? "page" : undefined}><HomeIcon /><span>Главная</span></Link>
      <Link className={styles.mobileNavItem} href="/catalog" aria-current={isCatalog ? "page" : undefined}><GridIcon /><span>Каталог</span></Link>
      <div className={styles.mobileNavItem}><CartIcon /><MobileCartButton /></div>
      <Link className={styles.mobileNavItem} href="/chat" aria-current={isChat ? "page" : undefined}><ChatIcon /><span>Чат</span></Link>
      <div className={styles.mobileNavItem}><UserIcon /><AccountNavigation isCurrent={isAccount} /></div>
    </nav>
  );
}

export function StoreShell({ children, initialSessionPresent }: { children: ReactNode; initialSessionPresent: boolean }) {
  return (
    <SessionNavigationProvider initialSessionPresent={initialSessionPresent}>
      <CartProvider>
        <div className={styles.storefront} data-storefront-root>
          <a className={styles.skipLink} href="#main-content">Перейти к содержанию</a>
          <StoreHeader />
          <main className={styles.main} id="main-content">{children}</main>
          <StoreFooter />
          <MobileNavigation />
          <CartPanel />
        </div>
      </CartProvider>
    </SessionNavigationProvider>
  );
}
