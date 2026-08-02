import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { CartButton, CartPanel, MobileCartButton } from "./cart-actions";
import { CartProvider } from "./cart-provider";
import { AccountNavigation, SessionNavigationProvider } from "./session-navigation";
import { ThemeToggle } from "./theme-toggle";
import styles from "./storefront.module.css";

type Theme = "dark" | "light" | "system";

const primaryLinks = [
  { href: "/catalog", label: "Каталог" },
  { href: "/delivery", label: "Доставка" },
  { href: "/how-to-order", label: "Как заказать" },
  { href: "/contacts", label: "Контакты" },
];

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

function StoreHeader({ initialTheme }: { initialTheme: Theme }) {
  return (
    <header className={styles.header}>
      <div className={styles.headerMain}>
        <Link className={styles.brand} href="/" aria-label="АН-30, на главную">
          <Image src="/logo.svg" alt="" width={250} height={250} priority />
          <span>Автозапчасти</span>
        </Link>
        <nav className={styles.desktopNav} aria-label="Основная навигация">
          {primaryLinks.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
        </nav>
        <div className={styles.headerActions}>
          <ThemeToggle initialTheme={initialTheme} />
          <CartButton />
          <AccountNavigation className={styles.accountLink} />
        </div>
        <details className={styles.mobileMenu}>
          <summary>Меню</summary>
          <nav aria-label="Мобильное меню">
            <Link href="/">Главная</Link>
            {[...primaryLinks, ...customerLinks.slice(1), ...companyLinks.slice(0, 1)].map((link) => (
              <Link key={`${link.href}-${link.label}`} href={link.href}>{link.label}</Link>
            ))}
            <AccountNavigation />
          </nav>
        </details>
      </div>
    </header>
  );
}

function StoreFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerGrid}>
        <section aria-labelledby="footer-store">
          <h2 id="footer-store">АН-30 Автозапчасти</h2>
          <p>Подбор автозапчастей для легковых и грузовых автомобилей в Чернышевске.</p>
          <p><a href="tel:+79244742605">+7 (924) 474-26-05</a></p>
          <p>Чернышевск, ул. Куйбышева, 118А</p>
          <p>Ежедневно с 09:00 до 19:00</p>
        </section>
        <nav aria-label="Покупателям">
          <h2>Покупателям</h2>
          {customerLinks.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
        </nav>
        <nav aria-label="О компании">
          <h2>Компания</h2>
          {companyLinks.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
        </nav>
        <section aria-labelledby="footer-contact">
          <h2 id="footer-contact">Связаться</h2>
          <a href="https://t.me/an30_autoparts" rel="noreferrer" target="_blank">Telegram</a>
          <a href="https://vk.com/an30_autoparts" rel="noreferrer" target="_blank">ВКонтакте</a>
          <Link href="/chat">Чат с магазином</Link>
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
