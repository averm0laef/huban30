import Link from "next/link";
import type { ReactNode } from "react";

import {
  MESSENGERS,
  SITE_LEGAL_NAME,
  STORE_HOURS,
  STORE_LOCALITY,
  STORE_PHONE,
  STORE_PHONE_DISPLAY,
  STORE_STREET,
} from "../../site-config";
import type { MessengerLink } from "../../site-config";
import { BrandLockup } from "./brand-mark";
import { CartButton, CartPanel, MobileCartButton } from "./cart-actions";
import { CartProvider } from "./cart-provider";
import { AccountNavigation, SessionNavigationProvider } from "./session-navigation";
import { ThemeToggle } from "./theme-toggle";
import styles from "./storefront.module.css";

type Theme = "dark" | "light" | "system";

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

function SearchIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

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

function MenuIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
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

function MessengerIcon({ id }: { id: MessengerLink["id"] }) {
  if (id === "telegram") {
    return (
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 2 11 13" />
        <path d="M22 2 15 22l-4-9-9-4Z" />
      </svg>
    );
  }
  if (id === "whatsapp") {
    return (
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.3 8.3 0 0 1-3.8-.9L3 21l1.9-5.7a8.3 8.3 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5Z" />
      </svg>
    );
  }
  return <span aria-hidden="true">{id === "vk" ? "VK" : "MAX"}</span>;
}

function HeaderSearchForm({ className, id }: { className?: string; id: string }) {
  return (
    <form className={className} action="/catalog" method="get" role="search">
      <label className={styles.visuallyHidden} htmlFor={id}>Поиск по VIN, названию или артикулу</label>
      <SearchIcon />
      <input id={id} name="q" type="search" minLength={2} maxLength={120} placeholder="VIN, название или артикул" />
      <button type="submit" aria-label="Найти в каталоге">Найти</button>
    </form>
  );
}

/** Secondary nav shared by the mobile burger (row B, &lt;768px) — everything
 * the desktop utility row (row A, ≥768px) doesn't have room to repeat. */
function SecondaryNav({ initialTheme }: { initialTheme: Theme }) {
  return (
    <nav aria-label="Дополнительное меню">
      <Link href="/">Главная</Link>
      <Link href="/catalog">Весь каталог</Link>
      <Link href="/expert-help">Подбор с экспертом</Link>
      <p className={styles.mobileMenuGroupLabel}>Клиентам</p>
      {customerLinks.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
      <p className={styles.mobileMenuGroupLabel}>Компания</p>
      {companyLinks.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
      <Link href="/profile#wishlist">Закладки</Link>
      <a className={styles.mobileMenuPhone} href={STORE_PHONE_HREF}>{STORE_PHONE_DISPLAY}</a>
      <ThemeToggle initialTheme={initialTheme} />
    </nav>
  );
}

/**
 * Two-row sticky header.
 *
 * Row A (`.headerTop`) is the light utility row: brand lockup, store
 * location, the "Подбор с экспертом" pill, phone/cart/account. It only
 * renders ≥768px — that boundary is deliberately the same one the bottom
 * tab bar (`MobileNavigation`) uses to appear, so cart/account access never
 * has a dead zone between the two (that gap used to sit at 768–980px).
 *
 * Row B (`.headerBand`) is the brand-blue search band. It is the only row
 * on narrow screens — "the whole header" there — and stays sticky at every
 * width because the surrounding `.header` wrapper is what is pinned.
 */
function StoreHeader({ initialTheme }: { initialTheme: Theme }) {
  return (
    <header className={styles.header}>
      <div className={styles.headerTop}>
        <div className={`${styles.sectionInner} ${styles.headerTopInner}`}>
          <Link className={styles.brand} href="/" aria-label={`${SITE_LEGAL_NAME}, на главную`}>
            <BrandLockup className={styles.brandLockup} />
          </Link>
          <Link className={styles.headerTopCatalog} href="/catalog">Каталог</Link>
          <span className={styles.headerLocation}>
            <PinIcon /> <span>{STORE_LOCALITY}, {STORE_STREET}</span>
          </span>
          <Link className={styles.pillGhost} href="/expert-help">
            <HeadsetIcon /> <span>Подбор с экспертом</span>
          </Link>
          <div className={styles.headerTopActions}>
            <a className={styles.headerIconLink} href={STORE_PHONE_HREF}>
              <PhoneIcon /> <span>{STORE_PHONE_DISPLAY}</span>
            </a>
            <ThemeToggle initialTheme={initialTheme} />
            <span className={styles.headerCartWrap}>
              <CartIcon />
              <CartButton />
            </span>
            <span className={styles.headerIconLink}>
              <UserIcon />
              <AccountNavigation />
            </span>
          </div>
        </div>
      </div>

      <div className={styles.headerBand}>
        <div className={`${styles.sectionInner} ${styles.headerBandInner}`}>
          <HeaderSearchForm className={styles.headerSearch} id="header-search-q" />
          <details className={styles.mobileMenu}>
            <summary aria-label="Меню"><MenuIcon /></summary>
            <SecondaryNav initialTheme={initialTheme} />
          </details>
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
            <span className={styles.footerWordmark} aria-hidden="true">АН-30</span>
            <h2 id="footer-store">{SITE_LEGAL_NAME}</h2>
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

function MobileNavigation() {
  return (
    <nav className={styles.mobileNav} aria-label="Быстрая навигация">
      <Link className={styles.mobileNavItem} href="/"><HomeIcon /><span>Главная</span></Link>
      <Link className={styles.mobileNavItem} href="/catalog"><GridIcon /><span>Каталог</span></Link>
      <div className={styles.mobileNavItem}><CartIcon /><MobileCartButton /></div>
      <Link className={styles.mobileNavItem} href="/chat"><ChatIcon /><span>Чат</span></Link>
      <div className={styles.mobileNavItem}><UserIcon /><AccountNavigation /></div>
    </nav>
  );
}

export function StoreShell({ children, initialSessionPresent, initialTheme }: { children: ReactNode; initialSessionPresent: boolean; initialTheme: Theme }) {
  return (
    <SessionNavigationProvider initialSessionPresent={initialSessionPresent}>
      <CartProvider>
        <div className={styles.storefront} data-storefront-root data-theme={initialTheme}>
          <a className={styles.skipLink} href="#main-content">Перейти к содержанию</a>
          <StoreHeader initialTheme={initialTheme} />
          <main className={styles.main} id="main-content">{children}</main>
          <StoreFooter />
          <MobileNavigation />
          <CartPanel />
        </div>
      </CartProvider>
    </SessionNavigationProvider>
  );
}
