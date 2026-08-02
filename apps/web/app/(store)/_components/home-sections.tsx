import Image from "next/image";
import Link from "next/link";
import type { ComponentType } from "react";

import { STORE_HOURS, STORE_LOCALITY, STORE_PHONE, STORE_PHONE_DISPLAY } from "../../site-config";
import styles from "./storefront.module.css";

const STORE_PHONE_HREF = `tel:${STORE_PHONE}`;

function ShieldCheckIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.2 19 6v5.5c0 4.6-3 8.3-7 9.3-4-1-7-4.7-7-9.3V6Z" />
      <polyline points="8.8 12.2 11 14.4 15.4 9.8" />
    </svg>
  );
}

function PackageIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8 12 3 3 8l9 5 9-5Z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  );
}

function HeadsetIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
      <rect x="3" y="13" width="4" height="6" rx="1.5" />
      <rect x="17" y="13" width="4" height="6" rx="1.5" />
      <path d="M19 19v1a3 3 0 0 1-3 3h-2" />
    </svg>
  );
}

/** Full-bleed photo hero: the only above-the-fold priority image on the page. */
export function HomeHero() {
  return (
    <section className={styles.hero} aria-labelledby="home-hero-title">
      <div className={styles.heroMedia}>
        <Image src="/banners/hero-banner.jpg" alt="" fill sizes="100vw" priority />
      </div>
      <div className={styles.heroScrim} aria-hidden="true" />
      <div className={styles.heroContent}>
        <h1 id="home-hero-title">
          Нужная запчасть <span className={styles.heroAccent}>без лишней переписки</span>
        </h1>
        <p>Ищите по названию или артикулу. Цена и остаток поступают из 1С и проверяются сервером перед оформлением.</p>
        <div className={styles.heroActions}>
          <Link className={styles.heroCta} href="/catalog">Открыть каталог</Link>
          <Link className={styles.pillGhost} href="/contacts">Связаться с магазином</Link>
        </div>
      </div>
    </section>
  );
}

interface InfoTile {
  icon: ComponentType;
  title: string;
  subtitle: string;
}

const infoTiles: InfoTile[] = [
  { icon: ShieldCheckIcon, title: "Гарантия качества", subtitle: "Проверяем совместимость перед продажей" },
  { icon: PackageIcon, title: "Доставка", subtitle: "Самовывоз из магазина, по согласованию" },
  { icon: ClockIcon, title: "Ежедневно", subtitle: STORE_HOURS.replace("Ежедневно ", "") },
  { icon: HeadsetIcon, title: "Помощь эксперта", subtitle: "Поможем подобрать деталь" },
];

/** Compact facts strip: real service conditions, no invented statistics. */
export function InfoStrip() {
  return (
    <div className={styles.infoStrip} aria-label="Условия покупки">
      {infoTiles.map((tile) => (
        <div className={styles.infoTile} key={tile.title}>
          <span className={styles.infoTileIcon}><tile.icon /></span>
          <span>
            <p className={styles.infoTileTitle}>{tile.title}</p>
            <p className={styles.infoTileSubtitle}>{tile.subtitle}</p>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Honest empty state: the catalog has zero products today, so we say so. */
export function CatalogTeaser() {
  return (
    <section className={styles.catalogTeaser} aria-labelledby="catalog-teaser-title">
      <div className={styles.sectionHead}>
        <h2 id="catalog-teaser-title">Запчасти в интернет-магазине</h2>
        <p>Ассортимент, цены и остатки формирует 1С. Карточки появляются здесь только с подтверждённой ценой и наличием — без демонстрационных позиций.</p>
      </div>
      <div className={styles.catalogTeaserEmpty}>
        <div className={styles.catalogTeaserEmptyMedia}>
          <Image src="/parts/404-spark-plug.png" alt="" width={220} height={220} />
        </div>
        <div className={styles.catalogTeaserEmptyBody}>
          <h3>Каталог пока пуст</h3>
          <p>Мы не показываем товары для примера. Пока список наполняется, найдите деталь по названию или артикулу — сотрудник магазина уточнит наличие и цену по телефону.</p>
          <div className={styles.catalogTeaserActions}>
            <Link className={styles.primaryAction} href="/catalog">Найти деталь</Link>
            <a className={styles.secondaryAction} href={STORE_PHONE_HREF}>Позвонить: {STORE_PHONE_DISPLAY}</a>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Real, non-carouselled explanation of how an order actually gets fulfilled. */
export function HowItWorks() {
  return (
    <section className={styles.howItWorks} aria-labelledby="how-it-works-title">
      <div className={styles.howItWorksMedia}>
        <Image
          src="/banners/banner-catalog.jpg"
          alt="Стеллажи с автозапчастями на складе"
          fill
          sizes="(max-width: 980px) 100vw, 530px"
        />
      </div>
      <div>
        <div className={styles.sectionHead}>
          <h2 id="how-it-works-title">Как купить</h2>
          <p>Онлайн-каталог наполняется постепенно. Актуальные цены и остатки всегда можно уточнить в магазине или по телефону.</p>
        </div>
        <ol className={styles.numberedList}>
          <li><strong>Найдите деталь</strong><span>По названию или артикулу в каталоге — или позвоните в магазин.</span></li>
          <li><strong>Дождитесь проверки</strong><span>Сервер и сотрудник магазина подтвердят цену, количество и совместимость с автомобилем.</span></li>
          <li><strong>Заберите заказ</strong><span>Самовывоз в {STORE_LOCALITY}; доставку можно согласовать с менеджером отдельно.</span></li>
        </ol>
        <Link className={`${styles.secondaryAction} ${styles.howItWorksMore}`} href="/how-to-order">Подробнее об оформлении</Link>
      </div>
    </section>
  );
}
