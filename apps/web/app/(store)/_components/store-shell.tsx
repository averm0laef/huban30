import Image from "next/image";
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
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

function ChevronDownIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function HeadsetIcon() {
  return (
    <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
      <rect x="3" y="13" width="4" height="6" rx="1.5" />
      <rect x="17" y="13" width="4" height="6" rx="1.5" />
      <path d="M19 19v1a3 3 0 0 1-3 3h-2" />
    </svg>
  );
}

function FileTextIcon() {
  return (
    <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
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
      <label className={styles.visuallyHidden} htmlFor={id}>Поиск по названию или артикулу</label>
      <input id={id} name="q" type="search" minLength={2} maxLength={120} placeholder="Поиск по названию или артикулу" />
      <button type="submit" aria-label="Найти в каталоге"><SearchIcon /></button>
    </form>
  );
}

function StoreHeader({ initialTheme }: { initialTheme: Theme }) {
  return (
    <header className={styles.header}>
      <div className={styles.headerMain}>
        <div className={`${styles.sectionInner} ${styles.headerMainInner}`}>
          <Link className={styles.brand} href="/" aria-label={`${SITE_LEGAL_NAME}, на главную`}>
            <span className={styles.brandMark}>
              <Image src="/brand/logo.svg" alt="" width={84} height={84} />
            </span>
          </Link>
          <Link className={styles.catalogButton} href="/catalog">
            <GridIcon />
            Каталог
          </Link>
          <HeaderSearchForm className={styles.headerSearch} id="header-search-q" />
          <div className={styles.headerActions}>
            <div className={styles.headerActionsSecondary}>
              <ThemeToggle initialTheme={initialTheme} />
              <Link className={styles.accountLink} href="/profile#wishlist">Закладки</Link>
              <AccountNavigation className={styles.accountLink} />
            </div>
            <CartButton />
          </div>
          <details className={styles.mobileMenu}>
            <summary>Меню</summary>
            <nav aria-label="Мобильное меню">
              <HeaderSearchForm className={styles.mobileSearch} id="mobile-search-q" />
              <Link href="/">Главная</Link>
              <Link href="/catalog">Каталог</Link>
              <Link href="/expert-help">Помощь эксперта</Link>
              <p className={styles.mobileMenuGroupLabel}>Клиентам</p>
              {customerLinks.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
              <p className={styles.mobileMenuGroupLabel}>Компания</p>
              {companyLinks.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
              <Link href="/profile#wishlist">Закладки</Link>
              <a className={styles.mobileMenuPhone} href={STORE_PHONE_HREF}>{STORE_PHONE_DISPLAY}</a>
              <ThemeToggle initialTheme={initialTheme} />
              <AccountNavigation />
            </nav>
          </details>
        </div>
      </div>
      <div className={styles.headerUtility}>
        <div className={`${styles.sectionInner} ${styles.headerUtilityInner}`}>
          <nav className={styles.headerUtilityNav} aria-label="Клиентам и о компании">
            <details className={styles.navDropdown} name="header-nav-menu">
              <summary>Клиентам <ChevronDownIcon /></summary>
              <div className={styles.navDropdownPanel}>
                {customerLinks.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
              </div>
            </details>
            <details className={styles.navDropdown} name="header-nav-menu">
              <summary>Компания <ChevronDownIcon /></summary>
              <div className={styles.navDropdownPanel}>
                {companyLinks.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
              </div>
            </details>
            <Link className={styles.pillGhost} href="/expert-help"><HeadsetIcon /> Помощь эксперта</Link>
            <Link className={styles.pillAccent} href="/contacts"><FileTextIcon /> Оставить заявку</Link>
          </nav>
          <div className={styles.headerUtilityInfo}>
            <span className={styles.headerUtilityFact}><ClockIcon /> {STORE_HOURS}</span>
            <a className={styles.headerPhone} href={STORE_PHONE_HREF}><PhoneIcon /> {STORE_PHONE_DISPLAY}</a>
            <Link className={styles.headerMapLink} href="/map"><PinIcon /> Адрес магазина</Link>
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
            <span className={styles.brandMark}>
              <Image src="/brand/logo.svg" alt="" width={60} height={60} />
            </span>
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
      <Link href="/">Главная</Link>
      <Link href="/catalog">Каталог</Link>
      <MobileCartButton />
      <Link href="/chat">Чат</Link>
      <AccountNavigation />
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
