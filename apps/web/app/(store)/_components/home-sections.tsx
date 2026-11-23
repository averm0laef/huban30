import Image from "next/image";
import Link from "next/link";

import { STORE_HOURS, STORE_PHONE, STORE_PHONE_DISPLAY, STORE_STREET } from "../../site-config";
import { getAvailableShowcase, getCategoryTree, type CatalogCategoryNode } from "../_lib/catalog-api";
import { formatRubles } from "../_lib/catalog-format";
import { categoryPath, findCategorySlugPath } from "../_lib/catalog-tree";
import { catalogSearchHref } from "../_lib/catalog-search-url";
import { catalogCategoryPhoto, categoryTiles, featuredCategoryKeys } from "../_lib/store-categories";
import { ArrowUndo24Regular, Box24Regular, Chat24Regular, ChevronRight20Regular } from "./home-icons";
import { ProductBuyButton } from "./cart-actions";
import { CatalogPhoto } from "./catalog-photo";
import { VinSelectionForm } from "./vin-selection-form";
import buttons from "./store-button.module.css";
import styles from "./catalog-showcase.module.css";

const services = [
  { title: "Как сделать заказ", description: "Поиск, подтверждение и получение", href: "/how-to-order", icon: Box24Regular },
  { title: "Возврат товара", description: "Условия и порядок возврата", href: "/returns", icon: ArrowUndo24Regular },
  { title: "Чат с магазином", description: "Вопросы о деталях и наличии", href: "/chat", icon: Chat24Regular },
];

const storeBenefits = [
  { title: "Подбор по VIN", description: "Проверим, подходит ли деталь вашему автомобилю.", icon: null },
  { title: "Оригинал или аналог", description: "Подскажем, когда стоит взять оригинал и какие есть аналоги.", icon: ArrowUndo24Regular },
  { title: "Привезём под заказ", description: "Если детали нет на полке, уточним срок у поставщика.", icon: Box24Regular },
];

export function CategoryCards({ tree, group }: { tree: CatalogCategoryNode[]; group?: "featured" | "more" }) {
  const tiles = group ? categoryTiles.filter(({ key }) => featuredCategoryKeys.has(key) === (group === "featured")) : categoryTiles;
  const variant = group === "featured" ? styles.featuredTiles : group === "more" ? styles.moreTiles : undefined;
  const imageSizes = {
    featured: "(max-width: 767px) 70px, 112px",
    more: "42px",
  };
  return (
    <div className={variant ? `${styles.tiles} ${variant}` : styles.tiles}>
      {tiles.map(({ key, label, query }) => {
        const path = findCategorySlugPath(tree, key);
        const href = path ? categoryPath(path) : catalogSearchHref(query);
        return (
          <Link className={styles.tile} href={href} key={key}>
            <span className={styles.tileLabel}>{label}</span>
            {group ? null : <span aria-hidden="true" className={styles.tileArrow}>↗</span>}
            <Image alt="" className={styles.tileImage} height={112} loading={group === "featured" ? "eager" : undefined}
              sizes={group ? imageSizes[group] : "(max-width: 860px) 78px, 90px"} src={`/categories/${key}.webp`} width={112} />
          </Link>
        );
      })}
    </div>
  );
}

export function CategoryBranches({ tree }: { tree: CatalogCategoryNode[] }) {
  if (tree.length === 0) return null;
  return (
    <nav className={styles.subsections} aria-label="Ветки каталога">
      <h3>Все разделы</h3>
      <ul>
        {tree.map(node => (
          <li key={node.id}>
            <Link href={categoryPath([node.slug])}>{node.name}<span>{node.productCount}</span></Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function SelectionCard() {
  return (
    <section className={`${styles.utility} ${styles.vinCard}`} aria-label="Подбор по автомобилю">
      <h2>Подбор по VIN</h2>
      <p>Менеджер проверит, какая деталь подойдёт к вашему автомобилю.</p>
      <VinSelectionForm />
      <Link className={styles.helpLink} href="/expert-help">Оставить заявку без VIN</Link>
    </section>
  );
}

export async function HomeShowcase() {
  const [tree, available] = await Promise.all([
    getCategoryTree().catch(() => []),
    getAvailableShowcase().catch(() => []),
  ]);
  return (
    <div className={styles.home}>
      <Link className={styles.deliveryBanner} href="/delivery">
        <strong>Доставка и самовывоз</strong>
        <span>Условия получения</span>
      </Link>
      <h1 className={styles.homeTitle}>Автозапчасти и расходники</h1>

      <section className={styles.homePanel} aria-labelledby="home-catalog">
        <header className={styles.sectionHeading}>
          <h2 id="home-catalog">Каталоги</h2>
          <Link className={styles.headingLink} href="/catalog">Весь каталог</Link>
        </header>
        <CategoryCards group="featured" tree={tree} />
        <nav className={styles.moreCategories} aria-label="Другие разделы каталога">
          <CategoryCards group="more" tree={tree} />
        </nav>
      </section>

      <div className={styles.homeHelp}>
        <section className={`${styles.homeHelpCard} ${styles.homeVin}`} aria-labelledby="home-vin">
          <div>
            <h2 id="home-vin">Подбор по VIN</h2>
            <p>Передайте VIN, чтобы мы проверили совместимость детали.</p>
          </div>
          <VinSelectionForm />
        </section>
        <section className={`${styles.homeHelpCard} ${styles.homeExpert}`} aria-labelledby="home-expert">
          <div>
            <h2 id="home-expert">Подберём за вас</h2>
            <p>Расскажите, что нужно. Специалист предложит подходящие варианты.</p>
          </div>
          <Link className={styles.homeAction} href="/expert-help">Обратиться к эксперту</Link>
        </section>
      </div>

      {available.length ? <section className={styles.homePanel} aria-labelledby="home-available">
        <header className={styles.sectionHeading}>
          <h2 id="home-available">В наличии в магазине</h2>
          <Link className={styles.headingLink} href="/catalog?availability=in_stock">Все товары</Link>
        </header>
        <div className={styles.availableGrid}>
          {available.map(item => (
            <article className={styles.availableItem} key={item.id}>
              <Link className={styles.availableDetails} href={`/catalog/product/${encodeURIComponent(item.slug)}`}>
                <CatalogPhoto className={styles.availableImage} noteInside
                  src={item.primaryImage?.url} categoryImage={catalogCategoryPhoto(item.category)}
                  sizes="(max-width: 767px) 162px, (max-width: 1440px) 22vw, 292px" />
                <span className={styles.availableName}>
                  <strong>{item.name}</strong>
                  <small>{item.brand?.name ? `${item.brand.name} · ` : ""}{item.sku}</small>
                  {item.priceKopeks !== null ? <b>{formatRubles(item.priceKopeks)}</b> : null}
                </span>
              </Link>
              {item.priceKopeks !== null && item.availableQuantity > 0 && (
                <div className={styles.availableActions}><ProductBuyButton available={item.availableQuantity} productId={item.id} /></div>
              )}
            </article>
          ))}
        </div>
      </section> : null}

      <section className={styles.homePanel} aria-labelledby="home-services">
        <header className={styles.sectionHeading}><h2 id="home-services">Покупателям</h2></header>
        <div className={styles.serviceLinks}>
          {services.map(({ title, description, href, icon: Icon }) => (
            <Link className={styles.serviceLink} href={href} key={href}>
              <Icon aria-hidden="true" />
              <div><h3>{title}</h3><p>{description}</p></div>
              <ChevronRight20Regular aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.homePanel} aria-labelledby="home-about">
        <header className={styles.aboutHeading}>
          <div>
            <h2 id="home-about">АН-30 — магазин запчастей в Чернышевске</h2>
            <p>Подбираем детали для легковых и грузовых автомобилей, проверяем совместимость и держим ходовые позиции в наличии.</p>
          </div>
          <Link className={styles.headingLink} href="/about">О компании</Link>
        </header>
        <ul className={styles.aboutBenefits}>
          {storeBenefits.map(({ title, description, icon: Icon }) => (
            <li key={title}>
              <span className={styles.aboutIcon} aria-hidden="true">{Icon ? <Icon /> : "VIN"}</span>
              <h3>{title}</h3>
              <p>{description}</p>
            </li>
          ))}
        </ul>
        <div className={styles.aboutContacts}>
          <div className={styles.aboutPickup}>
            <div>
              <strong>Самовывоз</strong>
              <span>{STORE_STREET} · {STORE_HOURS}</span>
            </div>
            <Link className={`${buttons.button} ${buttons.accent}`} href="/map">Маршрут</Link>
          </div>
          <div className={styles.aboutCall}>
            <div>
              <a href={`tel:${STORE_PHONE}`}>{STORE_PHONE_DISPLAY}</a>
              <span>Звоните или пишите нам</span>
            </div>
            <Link className={`${buttons.button} ${buttons.outline}`} href="/chat">Написать в чат</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
