"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { formatRubles } from "../_lib/catalog-format";
import { summariseCart, useCartProducts } from "../_lib/cart-products";
import type { CartLineView } from "../_lib/cart-products";
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

export function CartButton() {
  const { itemCount, openCart } = useCart();

  return (
    <button type="button" className="storefront-cart-button" onClick={openCart} aria-haspopup="dialog">
      Корзина <span aria-label={`${itemCount} товаров`}>{itemCount}</span>
    </button>
  );
}

export function MobileCartButton() {
  const { itemCount, openCart } = useCart();
  return <button type="button" onClick={openCart}>Корзина <span aria-label={`${itemCount} товаров`}>{itemCount}</span></button>;
}

export function CartPanel() {
  const { cartOpen, clear, closeCart, hydrated, itemCount, items, persistenceAvailable, removeItem, updateQuantity } = useCart();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const products = useCartProducts(items);
  const { hasUnavailable, knownSubtotalKopeks, lines, pricesComplete } = summariseCart(items, products);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (cartOpen && !dialog.open) dialog.showModal();
    if (!cartOpen && dialog.open) dialog.close();
  }, [cartOpen]);

  return (
    <dialog ref={dialogRef} className="storefront-cart-dialog" onClose={closeCart} onCancel={closeCart} aria-labelledby="cart-title">
      <div className="storefront-cart-dialog-head">
        <h2 id="cart-title">Корзина</h2>
        <button type="button" onClick={closeCart} aria-label="Закрыть корзину">Закрыть</button>
      </div>
      <strong>{itemCount > 0 ? `Товаров: ${itemCount}` : "Корзина пуста"}</strong>
      <p>{itemCount > 0 ? "Цена и наличие будут заново проверены сервером при оформлении." : "Добавьте товары из каталога."}</p>
      {hydrated && !persistenceAvailable ? <p className="storefront-cart-storage-notice" role="status">Корзина работает в этой вкладке, но браузер не разрешил сохранить её после закрытия.</p> : null}
      {hasUnavailable ? <p className="storefront-cart-storage-notice" role="status">Часть позиций больше не продаётся. Удалите их перед оформлением.</p> : null}
      {itemCount > 0 ? <div className="storefront-cart-lines">{lines.map((line, index) => (
        <div key={line.productId}>
          <CartLineIdentity line={line} position={index + 1} />
          <input aria-label={`Количество позиции ${index + 1}`} type="number" min={1} max={100} value={line.quantity} onChange={(event) => updateQuantity(line.productId, Number(event.target.value))} />
          <button type="button" aria-label={`Удалить позицию ${index + 1} из корзины`} onClick={() => removeItem(line.productId)}>Удалить</button>
        </div>
      ))}</div> : null}
      {itemCount > 0 ? (
        <p className="storefront-cart-subtotal">
          <span>Предварительно</span>
          <strong>{formatRubles(knownSubtotalKopeks)}{pricesComplete ? "" : " и выше"}</strong>
        </p>
      ) : null}
      {itemCount > 0 ? <div className="storefront-cart-actions"><button type="button" aria-label="Очистить всю корзину" onClick={clear}>Очистить</button><Link href="/checkout" onClick={closeCart}>Оформить заказ</Link></div> : null}
    </dialog>
  );
}

export function AddToCartButton({ disabled, productId }: { disabled?: boolean; productId: string }) {
  const { addItem } = useCart();
  const [added, setAdded] = useState(false);

  return (
    <button
      type="button"
      className="storefront-add-cart"
      disabled={disabled}
      onClick={() => {
        addItem(productId);
        setAdded(true);
      }}
    >
      {disabled ? "Нет в наличии" : added ? "Добавлено" : "В корзину"}
    </button>
  );
}
