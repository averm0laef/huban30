import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { STORE_HOURS, STORE_LOCALITY, STORE_STREET } from "../../../../site-config";
import { AddToCartButton } from "../../../_components/cart-actions";
import { JsonLd } from "../../../_components/json-ld";
import styles from "../../../_components/storefront.module.css";
import { findCatalogItem, formatRubles } from "../../../_lib/catalog-api";
import { breadcrumbJsonLd, pageMetadata, privatePageMetadata, productJsonLd } from "../../../_lib/seo";

interface ProductPageProps {
  params: Promise<{ slug: string }>;
}

function productDescription(name: string, sku: string, brandName: string | null): string {
  const brand = brandName ? `${brandName}, ` : "";
  return `${name} — ${brand}артикул ${sku}. Цена и наличие из 1С, проверка совместимости сотрудником АН-30 в Чернышевске.`;
}

function PinIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s7-6.7 7-12.2A7 7 0 0 0 5 8.8C5 14.3 12 21 12 21Z" />
      <circle cx="12" cy="8.8" r="2.4" />
    </svg>
  );
}

function TruckIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 7h11v10H2z" />
      <path d="M13 10h4l4 3.2V17h-8" />
      <circle cx="6" cy="18.5" r="1.6" />
      <circle cx="16.5" cy="18.5" r="1.6" />
    </svg>
  );
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await findCatalogItem(slug);
  if (!product) return privatePageMetadata("Товар не найден", "Запрошенный товар отсутствует в каталоге АН-30.");
  return pageMetadata({
    description: productDescription(product.name, product.sku, product.brand?.name ?? null),
    path: `/catalog/product/${product.slug}`,
    title: product.name,
  });
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = await findCatalogItem(slug);
  if (!product) notFound();
  const available = product.availableQuantity > 0;

  return (
    <div className={styles.page}>
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
        { name: product.name, path: `/catalog/product/${product.slug}` },
      ])} />
      <nav className={styles.breadcrumbs} aria-label="Хлебные крошки">
        <Link href="/">Главная</Link><span aria-hidden="true">/</span>
        <Link href="/catalog">Каталог</Link><span aria-hidden="true">/</span>
        <span aria-current="page">{product.name}</span>
      </nav>
      <article className={styles.productLayout}>
        {product.primaryImage ? (
          <div className={styles.productVisualLarge}>
            <Image alt={product.primaryImage.altText} fill sizes="(max-width: 767px) 100vw, 560px" src={product.primaryImage.url} />
          </div>
        ) : (
          <div className={styles.productVisualLarge} role="img" aria-label={`У товара «${product.name}» пока нет фотографии`}>
            Нет фото
          </div>
        )}
        <div className={styles.productInfo}>
          <p className={styles.productBrandArticle}>
            {product.brand ? <><strong>{product.brand.name}</strong> · </> : null}Артикул {product.sku}
          </p>
          <h1>{product.name}</h1>
          <p className={`${styles.stock} ${available ? "" : styles.stockOut}`}>{available ? `В наличии: ${product.availableQuantity}` : "Нет в наличии"}</p>
          <p className={styles.productPrice}>{product.priceKopeks === null ? "Цена уточняется" : formatRubles(product.priceKopeks)}</p>
          <AddToCartButton disabled={!available || product.priceKopeks === null} productId={product.id} />
          <p className={styles.productNote}>Окончательная цена, совместимость и остаток проверяются сервером перед созданием заказа.</p>
          <div className={styles.productFulfillment}>
            <div className={styles.productFulfillmentItem}>
              <PinIcon />
              <div>
                <strong>Самовывоз</strong>
                <span>{STORE_LOCALITY}, {STORE_STREET} · {STORE_HOURS}</span>
              </div>
            </div>
            <div className={styles.productFulfillmentItem}>
              <TruckIcon />
              <div>
                <strong>Доставка</strong>
                <span>Условия согласуются с менеджером отдельно</span>
              </div>
            </div>
          </div>
          <Link className={styles.secondaryAction} href="/expert-help">Спросить специалиста</Link>
        </div>
      </article>
    </div>
  );
}
