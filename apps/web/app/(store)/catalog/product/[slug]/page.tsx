import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

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
        <div className={styles.productVisualLarge} role="img" aria-label={`У товара «${product.name}» пока нет фотографии`}>
          Нет фото
        </div>
        <div className={styles.productInfo}>
          <p className={styles.productMeta}>Артикул: {product.sku}</p>
          <h1>{product.name}</h1>
          <p className={`${styles.stock} ${available ? "" : styles.stockOut}`}>{available ? `В наличии: ${product.availableQuantity}` : "Нет в наличии"}</p>
          <p className={styles.productPrice}>{product.priceKopeks === null ? "Цена уточняется" : formatRubles(product.priceKopeks)}</p>
          <AddToCartButton disabled={!available || product.priceKopeks === null} productId={product.id} />
          <p className={styles.productNote}>Окончательная цена, совместимость и остаток проверяются сервером перед созданием заказа.</p>
          <Link className={styles.secondaryAction} href="/expert-help">Спросить специалиста</Link>
        </div>
      </article>
    </div>
  );
}
