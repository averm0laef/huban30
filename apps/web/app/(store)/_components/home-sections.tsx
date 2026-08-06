import Image from "next/image";
import Link from "next/link";

import { STORE_HOURS, STORE_LOCALITY, STORE_PHONE, STORE_PHONE_DISPLAY, STORE_STREET } from "../../site-config";
import { getCategoryTree } from "../_lib/catalog-api";
import { categoryPath, findCategorySlugPath } from "../_lib/catalog-tree";
import { PromoCarousel } from "./promo-carousel";
import type { PromoSlide } from "./promo-carousel";
import { HeaderSearchForm } from "./search-box";
import { computeShopStatusNow } from "./shop-status";
import { ShopStatusBlock } from "./shop-status-block";
import styles from "./storefront.module.css";

const STORE_PHONE_HREF = `tel:${STORE_PHONE}`;

const promoSlides: PromoSlide[] = [
  {
    href: "/catalog",
    src: "/banners/promo-parts.webp",
    title: "Нужная запчасть без лишней переписки",
    text: "Ищите по названию, артикулу или VIN — цену и остаток проверяет сервер перед оформлением.",
    cta: "Открыть каталог",
  },
  {
    href: "/expert-help",
    src: "/banners/promo-brakes.webp",
    title: "Не уверены в артикуле?",
    text: "Сотрудник магазина поможет подобрать деталь по VIN или марке автомобиля.",
    cta: "Подбор с экспертом",
  },
  {
    href: "/delivery",
    src: "/banners/promo-warehouse.webp",
    title: "Самовывоз сегодня, доставка по договорённости",
    text: `${STORE_LOCALITY}, ${STORE_STREET} · ${STORE_HOURS}`,
    cta: "Условия доставки",
  },
  {
    href: "/catalog",
    src: "/banners/promo-oil.webp",
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
}

/**
 * Twelve real product-group photos (320x320 WebP, transparent background)
 * live in `public/categories/`, one per tile below — replacing the earlier
 * CSS-drawn placeholder glyphs now that photography exists for these
 * groups. `key` doubles as the image filename.
 */
const categoryTiles: CategoryTile[] = [
  { key: "motornye-masla", label: "Моторные масла", query: "моторное масло" },
  { key: "filtry", label: "Фильтры", query: "фильтр" },
  { key: "tormoznaya-sistema", label: "Тормозная система", query: "тормоз" },
  { key: "akkumulyatory", label: "Аккумуляторы", query: "аккумулятор" },
  { key: "transmissionnye-masla", label: "Трансмиссионные масла", query: "трансмиссионное масло" },
  { key: "antifriz", label: "Антифриз", query: "антифриз" },
  { key: "avtolampy", label: "Автолампы", query: "лампа" },
  { key: "shchetki", label: "Щётки стеклоочистителя", query: "щетки" },
  { key: "gidravlicheskaya-zhidkost", label: "Гидравлическая жидкость", query: "гидравлическая жидкость" },
  { key: "avtohimiya", label: "Автохимия", query: "автохимия" },
  { key: "instrumenty", label: "Инструменты", query: "инструмент" },
  { key: "tehosmotr", label: "Товары для техосмотра", query: "техосмотр" },
];

/**
 * The site's main navigation pattern: category tiles rather than a header
 * mega-menu. Each tile's `key` doubles as the slug a matching 1C category is
 * expected to use (see `packages/database/migrations/0001_initial_schema.sql`
 * for `app.categories.slug`). Once that category exists the tile links
 * straight to it; until then — the catalog starts empty and only fills in
 * from a 1C import — it degrades honestly to the old free-text search link
 * instead of pointing at a category page that would 404.
 */
export async function CategoryGrid() {
  let tree: Awaited<ReturnType<typeof getCategoryTree>> = [];
  try {
    tree = await getCategoryTree();
  } catch {
    // The home page's job is to get someone into the catalog, not to prove
    // the category tree endpoint is healthy — a transient outage here just
    // falls every tile back to its search link below, same as an empty tree.
  }

  return (
    <section className={styles.categorySection} aria-labelledby="category-grid-title">
      <div className={styles.sectionHead}>
        <h2 id="category-grid-title">Популярные товары для любых авто</h2>
        <p>Выберите раздел — мы поищем в каталоге по названию. Ассортимент наполняется из 1С постепенно.</p>
      </div>
      <div className={styles.categoryGrid}>
        {categoryTiles.map(({ key, label, query }) => {
          const slugPath = findCategorySlugPath(tree, key);
          const href = slugPath ? categoryPath(slugPath) : `/catalog?q=${encodeURIComponent(query)}`;
          return (
            <Link className={styles.categoryTile} href={href} key={key}>
              <span className={styles.categoryTileMedia}>
                <Image alt="" height={320} src={`/categories/${key}.webp`} width={320} />
              </span>
              <span className={styles.categoryTileLabel}>{label}</span>
            </Link>
          );
        })}
      </div>
      <div className={styles.categoryMore}>
        <Link className={styles.secondaryAction} href="/catalog">Открыть весь каталог</Link>
      </div>
    </section>
  );
}

/**
 * Three blocks that each *do* something, replacing the old 2x3 grid of
 * claim tiles ("Гарантия качества", "Ежедневно 09:00–19:00" next to a thin
 * icon-in-a-circle) — the owner's call: those tiles only asserted facts a
 * visitor had to take on faith, and the pictograms could belong to any
 * shop in any industry. Each block below is either computed from a real
 * clock, a real search, or a real link — nothing here is illustration:
 *  1. `ShopStatusBlock` — open/closed right now, computed server-side
 *     (see `computeShopStatusNow` below) and kept fresh client-side (see
 *     shop-status-block.tsx) so an open tab never shows a stale answer.
 *  2. The VIN/article field is the exact same `HeaderSearchForm` the
 *     header uses — one search implementation, not a tile describing one.
 *  3. The expert-help block is a real link to `/expert-help`, with the
 *     one honest wait-time fact the shop has actually committed to.
 * Photographs (an engine bay, a car in plan view — both already in
 * `public/parts/`) stand in for icons where a real object reads better
 * than an abstract glyph; the status block instead gets a plain colour
 * dot, because that *is* the information, not decoration for it.
 */
export function FeaturePanel() {
  const initialStatus = computeShopStatusNow();

  return (
    <section className={styles.featurePanel} aria-labelledby="feature-panel-title">
      <div className={styles.featurePanelInner}>
        <p className={styles.featurePanelHead} id="feature-panel-title">Магазин прямо сейчас</p>
        <div className={styles.quickBlocks}>
          <ShopStatusBlock initialStatus={initialStatus} />

          <div className={styles.quickBlock}>
            <div className={styles.quickBlockMedia}>
              <Image alt="" height={90} src="/parts/engine-bay.png" width={160} />
            </div>
            <p className={styles.quickBlockTitle}>Знаете VIN или артикул?</p>
            <div className={styles.quickBlockSearch}>
              <HeaderSearchForm id="home-quick-search-q" />
            </div>
            <p className={styles.quickBlockHint}>VIN указан в СТС, ПТС или на кузове автомобиля. На японских авто вместо VIN используйте номер рамы (frame).</p>
          </div>

          <div className={styles.quickBlock}>
            <div className={styles.quickBlockMedia}>
              <Image alt="" height={90} src="/parts/lc300-topdown.png" width={160} />
            </div>
            <p className={styles.quickBlockTitle}>Не уверены, какая деталь нужна?</p>
            <p className={styles.quickBlockText}>Менеджер отвечает обычно за 10 минут — в чате или по телефону.</p>
            <Link className={styles.quickBlockCta} href="/expert-help">Спросить эксперта</Link>
          </div>
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
