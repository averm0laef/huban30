import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AddToCartButton } from "../../../_components/cart-actions";
import styles from "../../../_components/storefront.module.css";
import { findCatalogItem, formatRubles } from "../../../_lib/catalog-api";

interface ProductPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await findCatalogItem(slug);
  return product ? { title: product.name, description: `Артикул ${product.sku}. Цена и наличие в магазине АН-30.` } : { title: "Товар не найден" };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = await findCatalogItem(slug);
  if (!product) notFound();
  const available = product.availableQuantity > 0;

  return (
    <div className={styles.page}>
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
