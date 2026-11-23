import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";

import { partNumberCatalogueApplies, umapiCatalogueApplies } from "@an30/contracts";

import { STORE_HOURS, STORE_LOCALITY, STORE_STREET } from "../../../../site-config";
import { ProductBuyButton } from "../../../_components/cart-actions";
import { ChevronRight20Regular, Location24Regular, VehicleTruck24Regular } from "../../../_components/home-icons";
import { JsonLd } from "../../../_components/json-ld";
import buttons from "../../../_components/store-button.module.css";
import styles from "../../../_components/storefront.module.css";
import { findCatalogItem, formatRubles, getCategoryTree } from "../../../_lib/catalog-api";
import { categoryPath, findCategorySlugPath } from "../../../_lib/catalog-tree";
import { breadcrumbJsonLd, pageMetadata, privatePageMetadata, productJsonLd } from "../../../_lib/seo";
import { catalogCategoryPhoto, publicSectionName } from "../../../_lib/store-categories";
import { productCompatibilityPrefillMessage, productPhotoPrefillMessage } from "../../../_lib/expert-help-prefill";
import { catalogFailureText } from "../../catalog-query";
import { ExpertHelpQueryLink } from "../../expert-help-query-link";
import { ProductAnalogs, ProductInStockAlternative } from "./product-analogs";
import { ProductCatalogueCheck } from "./product-catalogue-check";
import { ProductFitment } from "./product-fitment";
import { ProductDetails } from "./product-details";
import { ProductFavourite } from "./product-favourite";
import { ProductGallery } from "./product-gallery";
import { loadProduct } from "./product-load";
import layout from "./product-page.module.css";

interface ProductPageProps {
  params: Promise<{ slug: string }>;
}

function productDescription(name: string, sku: string, brandName: string | null): string {
  const brand = brandName ? `${brandName}, ` : "";
  return `${name} — ${brand}артикул ${sku}. Актуальная цена и наличие, самовывоз в Чернышевске, помощь с подбором по VIN.`;
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const load = await loadProduct(slug, findCatalogItem);
  if (load.kind === "moved") permanentRedirect(`/catalog/product/${load.slug}`);
  if (load.kind === "busy") return privatePageMetadata("Слишком много запросов", catalogFailureText(429).message);
  if (load.kind === "missing") return privatePageMetadata("Товар не найден", "Запрошенный товар отсутствует в каталоге АН-30.");
  const { product } = load;
  return pageMetadata({
    description: productDescription(product.name, product.sku, product.brand?.name ?? null),
    path: `/catalog/product/${product.slug}`,
    title: product.name,
  });
}

/**
 * Only human-readable characteristics from 1С reach the page: keys written in
 * Russian with a short scalar value. Technical keys (ids, flags, hashes) that
 * the import keeps for itself stay out of the customer's view.
 */
function visibleAttributes(attributes: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(attributes)
    .filter(([key]) => /[А-Яа-яЁё]/u.test(key))
    .map(([key, value]): [string, string] | null => {
      if (typeof value === "number" && Number.isFinite(value)) return [key, String(value)];
      if (typeof value === "boolean") return [key, value ? "Да" : "Нет"];
      if (typeof value === "string" && value.trim() && value.length <= 200) return [key, value.trim()];
      return null;
    })
    .filter((entry): entry is [string, string] => entry !== null)
    .slice(0, 24);
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const load = await loadProduct(slug, findCatalogItem);
  if (load.kind === "missing") notFound();
  // A former address of a product renamed in 1С: links a search engine or a customer kept still work.
  if (load.kind === "moved") permanentRedirect(`/catalog/product/${load.slug}`);
  if (load.kind === "busy") return <ProductBusy slug={slug} />;
  const { product } = load;
  const available = product.availableQuantity > 0;
  const priced = product.priceKopeks !== null;

  let categoryTrail: Array<{ name: string; path: string }> = [];
  let categoryAncestors: string[] = [];
  if (product.category) {
    try {
      const tree = await getCategoryTree();
      const slugPath = findCategorySlugPath(tree, product.category.slug);
      if (slugPath) {
        categoryAncestors = slugPath;
        let level = tree;
        categoryTrail = slugPath.map((part, index) => {
          const node = level.find((item) => item.slug === part);
          level = node?.children ?? [];
          return { name: node?.name ?? part, path: categoryPath(slugPath.slice(0, index + 1)) };
        });
      }
    } catch {
      // Breadcrumbs fall back to "Каталог" alone if the tree is unavailable.
    }
  }

  const specs: Array<[string, string]> = [
    ...(product.brand ? [["Бренд", product.brand.name] as [string, string]] : []),
    ["Артикул", product.sku],
    ...(product.category ? [["Раздел", publicSectionName(product.category)] as [string, string]] : []),
    // What the name says plainly of the part (side, voltage, size…) and the vehicle maker's numbers it carries.
    ...product.features.map((feature): [string, string] => [feature.label, feature.value]),
    ...(product.originalNumbers.length > 0 ? [["Оригинальные номера", product.originalNumbers.join(", ")] as [string, string]] : []),
    ...visibleAttributes(product.attributes),
  ];
  const images = product.images.length
    ? product.images.map((image) => ({ altText: image.altText, id: image.id, url: image.url }))
    : product.primaryImage ? [{ altText: product.primaryImage.altText, id: product.primaryImage.id, url: product.primaryImage.url }] : [];
  const stockText = available
    ? product.availableQuantity > 10 ? "В наличии, больше 10 шт." : `В наличии ${product.availableQuantity} шт.`
    : "Нет в наличии";

  const prefill = productCompatibilityPrefillMessage(product.name, product.sku);
  // The parts catalogue (UMAPI) may be asked about it on a button: compatibility, photo, analogs.
  const catalogueApplies = umapiCatalogueApplies({
    brand: product.brand?.name ?? null, name: product.name, section: categoryAncestors[0] ?? product.category?.slug ?? null, sku: product.sku,
  });
  const detailPanels = [
    ...(product.description ? [{ id: "about", label: "Описание", content: <p className={layout.detailsText}>{product.description}</p> }] : []),
    { id: "specs", label: "Характеристики", content: <SpecTable specs={specs} /> },
    { id: "delivery", label: "Получение", content: <>
      <h2>Как получить заказ</h2>
      <p className={layout.detailsText}>Самовывоз по адресу {STORE_LOCALITY}, {STORE_STREET}. {STORE_HOURS}. Условия доставки согласует менеджер.</p>
      <Link className={`${buttons.button} ${buttons.quiet} ${layout.detailAction}`} href="/delivery">
        Подробнее о доставке и самовывозе
        <ChevronRight20Regular aria-hidden="true" />
      </Link>
    </> },
  ];

  return (
    <div className={`${styles.page} ${layout.productPage}`}>
      <JsonLd value={productJsonLd({
        availableQuantity: product.availableQuantity,
        brandName: product.brand?.name ?? null,
        description: product.description,
        name: product.name,
        priceKopeks: product.priceKopeks,
        sku: product.sku,
        slug: product.slug,
      })} />
      <JsonLd value={breadcrumbJsonLd([
        { name: "Главная", path: "/" },
        { name: "Каталог", path: "/catalog" },
        ...categoryTrail,
        { name: product.name, path: `/catalog/product/${product.slug}` },
      ])} />
      <nav className={`${styles.breadcrumbs} ${layout.crumbs}`} aria-label="Хлебные крошки">
        <Link href="/">Главная</Link><span aria-hidden="true">/</span>
        <Link href="/catalog">Каталог</Link><span aria-hidden="true">/</span>
        {categoryTrail.map((crumb) => (
          <span key={crumb.path} className={styles.breadcrumbStep}><Link href={crumb.path}>{crumb.name}</Link><span aria-hidden="true">/</span></span>
        ))}
        <span className={layout.crumbCurrent} aria-current="page">{product.name}</span>
      </nav>
      <article className={layout.hero}>
        <ProductGallery catalogPhotos={catalogueApplies} categoryImage={catalogCategoryPhoto(product.category, categoryAncestors)} images={images} key={`gallery-${product.id}`} productId={product.id}
          requestMessage={productPhotoPrefillMessage(product.name, product.sku)} />

        <div className={layout.info}>
          <div className={layout.identity}>
            {product.brand ? <strong className={layout.brand}>{product.brand.name}</strong> : null}
            <span>Артикул {product.sku}</span>
          </div>
          <h1>{product.name}</h1>
          {specs.length > 1 ? <SpecTable specs={specs.filter(([label]) => label !== "Бренд" && label !== "Артикул").slice(0, 4)} /> : null}
          {product.packSizes.length > 0 ? (
            <nav aria-label="Другие фасовки" className={layout.packSizes}>
              <strong>Другие фасовки</strong>
              <ul>
                {product.packSizes.map((pack) => (
                  <li key={pack.slug}>
                    <Link href={`/catalog/product/${encodeURIComponent(pack.slug)}`} title={pack.name}>
                      <b>{pack.label}</b>
                      <span>{pack.priceKopeks === null ? "Цена по запросу" : formatRubles(pack.priceKopeks)}</span>
                      <small data-available={pack.availableQuantity > 0}>{pack.availableQuantity > 0 ? "В наличии" : "Под заказ"}</small>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          <ProductCatalogueCheck applies={catalogueApplies} key={`check-${product.id}`} prefill={prefill} productId={product.id} />
        </div>

        <aside className={layout.buy} aria-label="Цена и получение">
          <div className={layout.buyBar}>
            <p className={layout.price}>{product.priceKopeks === null ? "Цена по запросу" : formatRubles(product.priceKopeks)}</p>
            <p className={`${styles.stock} ${available ? "" : styles.stockOut}`}>{stockText}</p>
          </div>
          {available ? null : <ProductInStockAlternative article={product.sku} brand={product.brand?.name ?? null} productId={product.id} key={`alternative-${product.id}`} />}
          <div className={layout.buyActions}>
            {priced && available ? <ProductBuyButton available={product.availableQuantity} productId={product.id} /> : (
              <ExpertHelpQueryLink className={`${styles.primaryAction} ${layout.buyHelp}`} prefillMessage={prefill}>
                {available ? "Узнать цену" : "Узнать о поступлении"}
              </ExpertHelpQueryLink>
            )}
            <ProductFavourite productId={product.id} key={product.id} />
          </div>
          <ul className={layout.fulfilment}>
            <li><Location24Regular aria-hidden="true" /><div><strong>Самовывоз</strong><span>{STORE_STREET}</span></div></li>
            <li><VehicleTruck24Regular aria-hidden="true" /><div><strong>Доставка</strong><span>Срок и стоимость уточнит менеджер</span></div></li>
          </ul>
        </aside>
      </article>

      <ProductDetails panels={detailPanels} key={product.id} />
      <ProductAnalogs article={product.sku} brand={product.brand?.name ?? null} catalogueApplies={catalogueApplies} productId={product.id} key={`analogs-${product.id}`} />
      <ProductFitment
        checkable={partNumberCatalogueApplies({ brand: product.brand?.name ?? null, section: categoryAncestors[0] ?? product.category?.slug ?? null, sku: product.sku })}
        key={`fitment-${product.id}`}
        productId={product.id}
        productName={product.name}
      />
    </div>
  );
}

/** Too many requests from the visitor's address: the page says so and how long to wait, instead of a site error. */
function ProductBusy({ slug }: { slug: string }) {
  const { heading, message } = catalogFailureText(429);
  return (
    <div className={styles.page}>
      <section className={styles.errorState} role="alert">
        <h2>{heading}</h2>
        <p>{message}</p>
        {/* A full reload of the same address: a client navigation would only repeat the same refused call. */}
        <a className={styles.submitButton} href={`/catalog/product/${encodeURIComponent(slug.trim().toLowerCase())}`}>Обновить страницу</a>
      </section>
    </div>
  );
}

function SpecTable({ specs }: { specs: Array<[string, string]> }) {
  return specs.length ? (
    <dl className={layout.specs}>
      {specs.map(([label, value], index) => <div key={`${label}-${index}`}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  ) : null;
}
