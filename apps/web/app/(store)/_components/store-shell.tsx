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
import { MobileDrawer } from "./mobile-drawer";
import { HeaderSearchForm } from "./search-box";
import { AccountNavigation, SessionNavigationProvider } from "./session-navigation";
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

/** Nav content shown inside the mobile drawer (`MobileDrawer`) — everything
 * the desktop utility row (row A, ≥768px) doesn't have room to repeat. */
function DrawerNav() {
  return (
    <nav aria-label="Дополнительное меню" className={styles.drawerNav}>
      <Link href="/">Главная</Link>
      <Link href="/catalog">Весь каталог</Link>
      <Link href="/expert-help">Подбор с экспертом</Link>
      <div aria-labelledby="drawer-group-customers" className={styles.drawerNavGroup} role="group">
        <p className={styles.drawerNavGroupLabel} id="drawer-group-customers">Клиентам</p>
        {customerLinks.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
      </div>
      <div aria-labelledby="drawer-group-company" className={styles.drawerNavGroup} role="group">
        <p className={styles.drawerNavGroupLabel} id="drawer-group-company">Компания</p>
        {companyLinks.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
      </div>
      <Link href="/profile#wishlist">Закладки</Link>
      <a className={styles.drawerNavPhone} href={STORE_PHONE_HREF}>{STORE_PHONE_DISPLAY}</a>
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
 * width because the surrounding `.header` wrapper is what is pinned. Below
 * 768px it also carries a solid-white `BrandLockup` (row A's own lockup is
 * hidden there), so the logo never disappears on a phone the way it used to.
 */
function StoreHeader() {
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
          <Link className={styles.headerBandBrand} href="/" aria-label={`${SITE_LEGAL_NAME}, на главную`}>
            <BrandLockup className={styles.headerBandBrandMark} tone="current" />
          </Link>
          <HeaderSearchForm id="header-search-q" />
          <MobileDrawer
            brand={(
              <Link className={styles.drawerBrand} href="/" aria-label={`${SITE_LEGAL_NAME}, на главную`}>
                <BrandLockup className={styles.drawerBrandMark} />
              </Link>
            )}
          >
            <DrawerNav />
          </MobileDrawer>
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
