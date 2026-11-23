"use client";

import { Add20Regular, Subtract20Regular } from "@fluentui/react-icons";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { formatRubles } from "../_lib/catalog-format";
import type { CartLineView } from "../_lib/cart-products";
import { catalogCategoryPhoto } from "../_lib/store-categories";
import { CatalogPhoto } from "./catalog-photo";
import commerce from "./commerce.module.css";
import { useCart } from "./cart-provider";

/** Renders the catalog identity of one cart line, or an honest fallback state. */
export function CartLineIdentity({ line, position }: { line: CartLineView; position: number }) {
  if (line.state.status === "ready") {
    const { brandName, name, priceKopeks, sku, slug } = line.state.product;
    return (
      <div className="storefront-cart-line-identity">
        <Link href={`/catalog/product/${slug}`}>{name}</Link>
        <small>{brandName ? `${brandName} · ` : ""}Артикул {sku}</small>
        <small>{priceKopeks === null ? "Цену уточняйте" : `${formatRubles(priceKopeks)} за штуку`}</small>
      </div>
    );
  }
  if (line.state.status === "unavailable") {
    return (
      <div className="storefront-cart-line-identity">
        <strong>Товар недоступен</strong>
        <small>Позиция снята с продажи. Удалите её, чтобы оформить заказ.</small>
      </div>
    );
  }
  if (line.state.status === "error") {
    return (
      <div className="storefront-cart-line-identity">
        <strong>Позиция {position}</strong>
        <small>Не удалось загрузить описание. Сервер проверит позицию при оформлении.</small>
      </div>
    );
  }
  return (
    <div className="storefront-cart-line-identity">
      <strong>Позиция {position}</strong>
      <small>Загружаем описание товара...</small>
    </div>
  );
}

export function CartButton({ className, icon }: { className?: string; icon?: ReactNode } = {}) {
  const { itemCount } = useCart();
  const pathname = usePathname();

  return (
    <Link className={["storefront-cart-button", className].filter(Boolean).join(" ")} href="/cart"
      aria-current={pathname === "/cart" ? "page" : undefined}>
      {icon}
      <span className="storefront-cart-button-label">Корзина <span aria-label={`${itemCount} товаров`} className="storefront-cart-count" key={itemCount}>{itemCount}</span></span>
    </Link>
  );
}

const MAX_LINE_QUANTITY = 100;

/** The largest quantity «+» may reach: the cart limit, or the stock when it is known. */
export function quantityLimit(available?: number | null): number {
  return available == null ? MAX_LINE_QUANTITY : Math.max(0, Math.min(MAX_LINE_QUANTITY, available));
}

export function CartQuantity({ available, productId, quantity }: {
  available?: number | null;
  productId: string;
  quantity: number;
}) {
  const { updateQuantity } = useCart();
  const limit = quantityLimit(available);
  return (
    <div className={commerce.quantity} role="group" aria-label="Количество товара">
      <button type="button" disabled={quantity <= 1} onClick={() => updateQuantity(productId, quantity - 1)}
        aria-label="Уменьшить количество"><Subtract20Regular aria-hidden="true" /></button>
      <output aria-live="polite" aria-label="Количество">{quantity}</output>
      <button type="button" disabled={quantity >= limit} onClick={() => updateQuantity(productId, quantity + 1)}
        aria-label="Увеличить количество"
        title={quantity >= limit && limit < MAX_LINE_QUANTITY ? "Больше нет в наличии" : undefined}><Add20Regular aria-hidden="true" /></button>
    </div>
  );
}

export function CartLineThumbnail({ line }: { line: CartLineView }) {
  const item = line.state.status === "ready" ? line.state.product : null;
  if (!item) return <span className={commerce.lineThumbnail} aria-hidden="true" />;
  return <CatalogPhoto className={commerce.lineThumbnail} sizes="72px" src={item.imageUrl}
    categoryImage={catalogCategoryPhoto(item.category)} showNote={false} />;
}

/**
 * A double click is one intent. The second click of a double click lands
 * within this window, on the same button or on whatever replaced it.
 */
const REPEAT_CLICK_WINDOW_MS = 500;

/** True when `now` is still inside the double-click window opened at `lastAt`. */
export function isRepeatClick(lastAt: number | null, now: number): boolean {
  return lastAt !== null && now - lastAt < REPEAT_CLICK_WINDOW_MS;
}

export function AddToCartButton({ disabled, onAdded, productId }: {
  disabled?: boolean;
  onAdded?: (at: number) => void;
  productId: string;
}) {
  const { addItem } = useCart();
  const [added, setAdded] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);
  const lastAddAt = useRef<number | null>(null);

  // "Добавлено" is a short confirmation, then the button is ready to add
  // another one; the header counter keeps the lasting signal.
  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  return (
    <button
      type="button"
      className="storefront-add-cart"
      data-added={added || undefined}
      disabled={disabled}
      onClick={(event) => {
        // Keyboard activation reports timeStamp too, so a held Enter is covered.
        if (isRepeatClick(lastAddAt.current, event.timeStamp)) return;
        lastAddAt.current = event.timeStamp;
        addItem(productId);
        onAdded?.(event.timeStamp);
        setAdded(true);
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setAdded(false), 1600);
      }}
    >
      {disabled ? "Нет в наличии" : added ? "Добавлено" : "В корзину"}
    </button>
  );
}

export function ProductBuyButton({ available, productId }: { available?: number; productId: string }) {
  const { items } = useCart();
  const addedAt = useRef<number | null>(null);
  const line = items.find(item => item.productId === productId);
  if (!line) return <AddToCartButton productId={productId} onAdded={(at) => { addedAt.current = at; }} />;
  return (
    // The stepper and the cart link take the place of «В корзину»: the second
    // click of a double click must not change the quantity or leave the page.
    <div className={commerce.productCartActions} onClickCapture={(event) => {
      if (!isRepeatClick(addedAt.current, event.timeStamp)) return;
      event.preventDefault();
      event.stopPropagation();
    }}>
      <CartQuantity available={available} productId={productId} quantity={line.quantity} />
      <Link href="/cart">В корзине</Link>
    </div>
  );
}
