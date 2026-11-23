"use client";

import Link from "next/link";

import { overStockNote, summariseCart, useCartProducts } from "../_lib/cart-products";
import { formatRubles } from "../_lib/catalog-format";
import { CartLineIdentity, CartLineThumbnail, CartQuantity } from "./cart-actions";
import { useCart } from "./cart-provider";
import styles from "./storefront.module.css";
import commerce from "./commerce.module.css";

const parts = new Intl.PluralRules("ru");

function itemsLabel(quantity: number) {
  const count = parts.select(quantity);
  return `${quantity} ${count === "one" ? "товар" : count === "few" ? "товара" : "товаров"}`;
}

export function CartClient() {
  const { hydrated, itemCount, items, persistenceAvailable, removeItem } = useCart();
  const products = useCartProducts(items);
  const { hasOverStock, hasUnavailable, knownSubtotalKopeks, lines, pricesComplete } = summariseCart(items, products);

  return (
    <div className={`${styles.page} ${commerce.page}`}>
      <nav className={commerce.crumbs} aria-label="Хлебные крошки">
        <Link href="/">Главная</Link><span aria-hidden="true">/</span><span aria-current="page">Корзина</span>
      </nav>
      <header className={commerce.heading}>
        <h1>Корзина</h1>
        {hydrated && itemCount > 0 ? <span>{itemsLabel(itemCount)}</span> : null}
      </header>
      {!hydrated ? (
        <section className={commerce.empty} role="status"><h2>Открываем корзину</h2></section>
      ) : itemCount === 0 ? (
        <section className={commerce.empty}>
          <h2>В корзине пока ничего нет</h2>
          <Link className={`${styles.primaryAction} ${commerce.action}`} href="/catalog">Перейти в каталог</Link>
        </section>
      ) : (
        <div className={commerce.columns}>
          <section className={commerce.panel} aria-label="Товары в корзине">
            {!persistenceAvailable ? <p className={commerce.notice} role="status">Корзина сохранится до закрытия вкладки.</p> : null}
            <ul className={commerce.cartRows}>
              {lines.map((line, index) => (
                <li className={commerce.cartRow} key={line.productId}>
                  <CartLineThumbnail line={line} />
                  <div className={commerce.lineIdentity}>
                    <CartLineIdentity line={line} position={index + 1} />
                    <small className={commerce.linePhotoNote}>Фото — в карточке товара</small>
                    <button className={commerce.remove} type="button"
                      onClick={() => removeItem(line.productId)} aria-label={`Удалить позицию ${index + 1} из корзины`}>Удалить</button>
                  </div>
                  <div className={commerce.lineQuantity}>
                    <CartQuantity available={line.availableQuantity} productId={line.productId} quantity={line.quantity} />
                    {line.overStock && line.availableQuantity !== null
                      ? <small className={commerce.stockWarning} role="status">{overStockNote(line.availableQuantity)}</small> : null}
                  </div>
                  <strong className={commerce.lineTotal}>{line.subtotalKopeks === null ? "Цена уточняется" : formatRubles(line.subtotalKopeks)}</strong>
                </li>
              ))}
            </ul>
          </section>

          <aside className={`${commerce.panel} ${commerce.summary}`} aria-labelledby="cart-summary-title">
            <h2 id="cart-summary-title">Ваш заказ</h2>
            <dl className={commerce.summaryFacts}><div><dt>Товары</dt><dd>{itemCount} шт.</dd></div></dl>
            <div className={commerce.grandTotal}>
              <span>Предварительно</span>
              <strong>{pricesComplete ? formatRubles(knownSubtotalKopeks) : knownSubtotalKopeks > 0 ? `от ${formatRubles(knownSubtotalKopeks)}` : "Уточняется"}</strong>
            </div>
            {hasUnavailable ? <p className={commerce.notice} role="status">Удалите недоступные позиции, чтобы оформить заявку.</p>
              : hasOverStock ? <p className={commerce.notice} role="status">В корзине больше, чем есть в наличии. Уменьшите количество, чтобы оформить заявку.</p> : (
              <Link className={`${styles.primaryAction} ${commerce.action} ${commerce.checkoutAction}`} href="/checkout">Перейти к оформлению</Link>
            )}
            <p>Оформить заявку можно без регистрации. Итоговую сумму подтвердит менеджер.</p>
          </aside>
        </div>
      )}
    </div>
  );
}
