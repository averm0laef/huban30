import Image from "next/image";
import Link from "next/link";

import { STORE_HOURS, STORE_LOCALITY, STORE_PHONE, STORE_PHONE_DISPLAY, STORE_STREET } from "../../site-config";
import { getCategoryTree } from "../_lib/catalog-api";
import { categoryPath, findCategorySlugPath } from "../_lib/catalog-tree";
import { BrandLockup } from "./brand-mark";
import { PromoCarousel } from "./promo-carousel";
import type { PromoSlide } from "./promo-carousel";
import { computeShopStatusNow } from "./shop-status";
import { ShopStatusBlock } from "./shop-status-block";
import styles from "./storefront.module.css";

const STORE_PHONE_HREF = `tel:${STORE_PHONE}`;

/**
 * Home page section order — follows a local auto-parts buyer's actual
 * decision path rather than the order features happened to ship in:
 *
 *  1. `HomePromo` (hero carousel) — the hook. Four value props, one per
 *     approved banner photo, each pointing at a *different* destination
 *     (`/catalog`, `/expert-help`, `/delivery`, `/catalog` again but with
 *     a distinct reason — see the slide list below) so the banner itself
 *     never shows the same call to action twice in a row.
 *  2. `CategoryGrid` — "does this shop even sell what I need?" The real
 *     category photos answer that before any copy has to.
 *  3. `FeaturePanel` — objections surface right after browsing: is the
 *     price real, are they open, do they actually check fit before
 *     shipping? Answered with the shop's live clock plus two sourced
 *     facts, not claim tiles — see its own docstring.
 *  4. `CatalogHelpBlock` — the close, for whoever scrolled this far
 *     without converting: an honest "catalog is still filling in" note
 *     paired with the one thing that already works today regardless of
 *     how many products are imported — a person who replies in about
 *     10 minutes.
 *
 * Before this pass, `/expert-help` had three near-identical entry points,
 * `/catalog` had four, the VIN/article search form was rendered twice
 * (header + a `FeaturePanel` quick block), and `CatalogTeaser` /
 * `ChooseHelpBlock` were two adjacent sections making the same "talk to a
 * human" point from different angles. Each action now has exactly one
 * obvious home; see the per-component comments below for specifics.
 */

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
    title: "Нет на складе — привезём под заказ",
    text: "Проверяем остатки у поставщиков и называем цену и срок ещё до оформления заказа.",
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
 * Live status plus two sourced facts, replacing both the old 2x3 grid of
 * claim tiles ("Гарантия качества" beside a thin icon-in-a-circle — the
 * owner's rejected pattern) *and* the two quick blocks this panel used to
 * also carry:
 *  - a second VIN/article search field. The header already renders
 *    `HeaderSearchForm` on every page at every width (see
 *    `.headerDesktopSearch` / `.mobileSearchRow` in storefront.module.css)
 *    — a duplicate copy directly beneath it taught a visitor nothing new,
 *    it just doubled the search form as one of the page's repeated
 *    actions the owner asked to collapse.
 *  - a second "Спросить эксперта" link. That action now lives once, in
 *    `CatalogHelpBlock` below, next to the one fact that actually earns
 *    the click — see that component's docstring.
 *
 * What is left is three things, none of them illustration:
 *  1. `ShopStatusBlock` — open/closed right now, computed server-side
 *     (see `computeShopStatusNow` below) and kept fresh client-side (see
 *     shop-status-block.tsx) so an open tab never shows a stale answer.
 *  2. Price/stock accuracy — the same server re-check already implemented
 *     at checkout (`checkout-client.tsx`: "Цена, остаток и резерв
 *     проверяются сервером") and on the product page (`productNote` in
 *     `catalog/product/[slug]/page.tsx`). Restated here, not invented.
 *  3. Compatibility — the same fact `/expert-help` and the product page's
 *     "Спросить специалиста" link already promise: a person checks fit
 *     before a sale, not an automated lookup.
 * Neither fact block carries a photograph or a pictogram, for the same
 * reason the status block's plain colour dot does not: the fact itself is
 * the content, so nothing here is illustrated on top of it.
 */
export function FeaturePanel() {
  const initialStatus = computeShopStatusNow();

  return (
    <section className={styles.featurePanel} aria-labelledby="feature-panel-title">
      <div className={styles.featurePanelInner}>
        <p className={styles.featurePanelHead} id="feature-panel-title">Как мы работаем</p>
        <div className={styles.quickBlocks}>
          <ShopStatusBlock initialStatus={initialStatus} />

          <div className={styles.quickBlock}>
            <p className={styles.quickBlockTitle}>Цену и остаток не показываем наугад</p>
            <p className={styles.quickBlockText}>Каталог получает их из 1С, а сервер повторно проверяет цену и остаток перед оформлением заказа — так же, как при оплате.</p>
          </div>

          <div className={styles.quickBlock}>
            <p className={styles.quickBlockTitle}>Совместимость проверяет человек</p>
            <p className={styles.quickBlockText}>Прежде чем продать деталь, сотрудник магазина сверяет её с вашим автомобилем — не по фото и общим характеристикам.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Merged replacement for the old `CatalogTeaser` + `ChooseHelpBlock` pair —
 * the owner's own complaint: "может быть соединить как-то два этих блока в
 * один, а то смотрится топорно". Both blocks made the same point (the
 * catalog can't finish the sale by itself yet, so talk to a person) from
 * two directions — one apologetic about the empty catalog, one an
 * unexplained brand panel repeating an `/expert-help` link already used
 * twice elsewhere on the page. One honest paragraph plus one real pair of
 * actions replaces both.
 *
 * Still says plainly that the catalog is empty today — seeing a populated
 * catalog it cannot yet show would be exactly the invented-confidence
 * pattern the owner rejected; it is only honest until the first 1С import
 * lands (see `one-c-exchange` on the API side). The brand panel stays —
 * the shop's own logotype (`BrandLockup`, already used on the header and
 * footer), not a stock photo — because a fully blank media slot here would
 * read as an unfinished page rather than a deliberate one.
 */
export function CatalogHelpBlock() {
  return (
    <section className={styles.helpBlock} aria-labelledby="help-block-title">
      <div className={styles.helpBlockMedia}>
        <BrandLockup className={styles.helpBlockMark} tone="current" />
      </div>
      <div className={styles.helpBlockBody}>
        <h2 id="help-block-title">Каталог пока пуст — но помочь можем уже сейчас</h2>
        <p>
          Ассортимент, цены и остатки формирует 1С, и карточки с фото добавляются постепенно.
          Опишите деталь сотруднику магазина — он отвечает обычно за 10 минут, проверит наличие на
          складе и возможность привезти её под заказ, и подтвердит совместимость с вашим автомобилем.
        </p>
        <div className={styles.helpBlockActions}>
          <Link className={styles.primaryAction} href="/expert-help">Спросить эксперта</Link>
          <a className={styles.secondaryAction} href={STORE_PHONE_HREF}>Позвонить: {STORE_PHONE_DISPLAY}</a>
        </div>
      </div>
    </section>
  );
}
