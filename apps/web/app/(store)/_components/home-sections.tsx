import Image from "next/image";
import Link from "next/link";
import type { ComponentType } from "react";

import { STORE_HOURS, STORE_LOCALITY, STORE_PHONE, STORE_PHONE_DISPLAY, STORE_STREET } from "../../site-config";
import { PromoCarousel } from "./promo-carousel";
import type { PromoSlide } from "./promo-carousel";
import styles from "./storefront.module.css";

const STORE_PHONE_HREF = `tel:${STORE_PHONE}`;

function EngineIcon() {
  return (
    <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="10" width="12" height="7" rx="1" />
      <path d="M15 12h3v3h-3" />
      <path d="M20 12.5v2" />
      <path d="M5 10V7h5v3" />
      <path d="M9 7V5" />
      <path d="M6 17v2" />
      <path d="M12 17v2" />
    </svg>
  );
}

function BrakeIcon() {
  return (
    <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v3M20.5 12h-3M12 20.5v-3M3.5 12h3" />
    </svg>
  );
}

function SuspensionIcon() {
  return (
    <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3v4" />
      <path d="M8 7c0 1.2 2.4 1.2 2.4 2.4S8 10.8 8 12s2.4 1.2 2.4 2.4S8 15.6 8 16.8" />
      <path d="M8 16.8V21" />
      <circle cx="17" cy="19" r="2.6" />
    </svg>
  );
}

function ElectricIcon() {
  return (
    <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </svg>
  );
}

function BodyIcon() {
  return (
    <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 16v-3.2c0-.5.2-.9.6-1.2L7 9l1.8-3A2 2 0 0 1 10.6 5h2.8a2 2 0 0 1 1.8 1.1L17 9l3.4 2.6c.4.3.6.7.6 1.2V16" />
      <path d="M3 16h18v2a1 1 0 0 1-1 1h-1.6a2 2 0 0 1-3.8 0H7.4a2 2 0 0 1-3.8 0H2a1 1 0 0 1-1-1v-2Z" />
      <path d="M7 9h10" />
    </svg>
  );
}

function OilIcon() {
  return (
    <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2h6v3.4l2.4 3.2c.4.5.6 1.1.6 1.7V20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V10.3c0-.6.2-1.2.6-1.7L9 5.4V2Z" />
      <path d="M7 14h10" />
    </svg>
  );
}

function ShieldCheckIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.2 19 6v5.5c0 4.6-3 8.3-7 9.3-4-1-7-4.7-7-9.3V6Z" />
      <polyline points="8.8 12.2 11 14.4 15.4 9.8" />
    </svg>
  );
}

function StoreIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5 4.5 4h15L21 9.5" />
      <path d="M4 9.5h16V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9.5Z" />
      <path d="M10 20v-5h4v5" />
    </svg>
  );
}

function TruckIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 7h11v10H2z" />
      <path d="M13 10h4l4 3.2V17h-8" />
      <circle cx="6" cy="18.5" r="1.6" />
      <circle cx="16.5" cy="18.5" r="1.6" />
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

function VinIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <path d="M8 9v4M11 9v4M14 9l-1.5 4" />
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

const promoSlides: PromoSlide[] = [
  {
    href: "/catalog",
    src: "/banners/hero-banner.jpg",
    title: "Нужная запчасть без лишней переписки",
    text: "Ищите по названию, артикулу или VIN — цену и остаток проверяет сервер перед оформлением.",
    cta: "Открыть каталог",
  },
  {
    href: "/expert-help",
    src: "/banners/banner-expert.jpg",
    title: "Не уверены в артикуле?",
    text: "Сотрудник магазина поможет подобрать деталь по VIN или марке автомобиля.",
    cta: "Подбор с экспертом",
  },
  {
    href: "/delivery",
    src: "/banners/banner-delivery.jpg",
    title: "Самовывоз сегодня, доставка по договорённости",
    text: `${STORE_LOCALITY}, ${STORE_STREET} · ${STORE_HOURS}`,
    cta: "Условия доставки",
  },
  {
    href: "/catalog",
    src: "/banners/banner-quality.jpg",
    title: "Проверяем совместимость перед продажей",
    text: "Мы не отправляем деталь, пока не убедимся, что она подходит вашему автомобилю.",
    cta: "Смотреть каталог",
  },
];

export function HomePromo() {
  return <PromoCarousel slides={promoSlides} />;
}

interface CategoryTile {
  key: string;
  label: string;
  query: string;
  Icon: ComponentType;
}

const categoryTiles: CategoryTile[] = [
  { key: "engine", label: "Двигатель", query: "двигатель", Icon: EngineIcon },
  { key: "brakes", label: "Тормозная система", query: "тормоз", Icon: BrakeIcon },
  { key: "suspension", label: "Подвеска", query: "подвеска", Icon: SuspensionIcon },
  { key: "electric", label: "Электрика", query: "электрика", Icon: ElectricIcon },
  { key: "body", label: "Кузов и оптика", query: "кузов", Icon: BodyIcon },
  { key: "fluids", label: "Масла и расходники", query: "масло", Icon: OilIcon },
];

/**
 * The site's main navigation pattern: category tiles rather than a header
 * mega-menu. There is no per-category taxonomy exposed to the storefront
 * (the catalog API only takes a free-text query), so each tile is an
 * honest shortcut into `/catalog?q=...` by a generic, universal auto-parts
 * term — not a claim about what is currently in stock.
 */
export function CategoryGrid() {
  return (
    <section className={styles.categorySection} aria-labelledby="category-grid-title">
      <div className={styles.sectionHead}>
        <h2 id="category-grid-title">Популярные товары для любых авто</h2>
        <p>Выберите раздел — мы поищем в каталоге по названию. Ассортимент наполняется из 1С постепенно.</p>
      </div>
      <div className={styles.categoryGrid}>
        {categoryTiles.map(({ key, label, query, Icon }) => (
          <Link className={styles.categoryTile} href={`/catalog?q=${encodeURIComponent(query)}`} key={key}>
            <span className={styles.categoryTileMedia}><Icon /></span>
            <span className={styles.categoryTileLabel}>{label}</span>
          </Link>
        ))}
      </div>
      <div className={styles.categoryMore}>
        <Link className={styles.secondaryAction} href="/catalog">Открыть весь каталог</Link>
      </div>
    </section>
  );
}

interface FeatureItem {
  Icon: ComponentType;
  title: string;
  text: string;
}

const featureItems: FeatureItem[] = [
  { Icon: VinIcon, title: "Поиск по VIN и артикулу", text: "Быстрый подбор без лишних переписок" },
  { Icon: ShieldCheckIcon, title: "Гарантия качества", text: "Проверяем совместимость перед продажей" },
  { Icon: StoreIcon, title: "Самовывоз", text: `${STORE_LOCALITY}, ${STORE_STREET}` },
  { Icon: TruckIcon, title: "Доставка по согласованию", text: "Условия уточняет менеджер" },
  { Icon: ClockIcon, title: "Ежедневно", text: STORE_HOURS.replace("Ежедневно ", "") },
  { Icon: HeadsetIcon, title: "Помощь эксперта", text: "Поможем подобрать деталь" },
];

/** Dark 2x3 feature panel — deliberately dark in both themes, real service facts only. */
export function FeaturePanel() {
  return (
    <section className={styles.featurePanel} aria-labelledby="feature-panel-title">
      <div className={styles.featurePanelInner}>
        <p className={styles.featurePanelHead} id="feature-panel-title">Условия покупки</p>
        <div className={styles.featureGrid}>
          {featureItems.map((item) => (
            <div className={styles.featureCard} key={item.title}>
              <span className={styles.featureCardIcon}><item.Icon /></span>
              <span>
                <p className={styles.featureCardTitle}>{item.title}</p>
                <p className={styles.featureCardText}>{item.text}</p>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
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

/** Light help block with a full-width primary CTA, per the reference pattern. */
export function ChooseHelpBlock() {
  return (
    <section className={styles.helpBlock} aria-labelledby="help-block-title">
      <div className={styles.helpBlockMedia}>
        <Image alt="" fill sizes="(max-width: 767px) 100vw, 500px" src="/banners/banner-catalog.jpg" />
      </div>
      <div className={styles.helpBlockBody}>
        <h2 id="help-block-title">Не знаете, какую запчасть выбрать?</h2>
        <p>Сотрудник магазина уточнит совместимость с вашим автомобилем по названию, артикулу или VIN — по телефону, в чате или очно в {STORE_LOCALITY}.</p>
        <Link className={`${styles.primaryAction} ${styles.fullWidthAction}`} href="/expert-help">Спросить эксперта</Link>
      </div>
    </section>
  );
}
