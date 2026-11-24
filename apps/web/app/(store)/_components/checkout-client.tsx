"use client";

import { Location24Regular, Person24Regular, VehicleTruck24Regular } from "@fluentui/react-icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

import { CHECKOUT_PERSONAL_DATA_CONSENT_TEXT } from "@an30/contracts";

import { refreshCartProducts, summariseCart, useCartProducts } from "../_lib/cart-products";
import { formatRubles } from "../_lib/catalog-format";
import { checkoutConfirmationMessage, checkoutPayload } from "../_lib/checkout";
import { checkoutDraftStorage, clearCheckoutDraft, readCheckoutDraft, saveCheckoutDraft } from "../_lib/checkout-draft";
import { clearIdempotencyKey, stableIdempotencyKey } from "../_lib/idempotency";
import { StorefrontApiError, apiRequest, errorText, readSession } from "../_lib/storefront-api";
import { CartLineIdentity, CartLineThumbnail } from "./cart-actions";
import commerce from "./commerce.module.css";
import { useCart } from "./cart-provider";
import { computeShopStatusNow } from "./shop-status";
import styles from "./storefront.module.css";
import { EmailField, PhoneField } from "./masked-fields";

interface CheckoutResponse {
  guestAccessToken: string | null;
  idempotentReplay: boolean;
  order: { id: string; publicNumber: string; status: string; subtotalKopeks: number; totalAmountKopeks: number };
}

interface AccountPrefill { displayName: string | null; email: string; phone: string | null }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const orderStatusLabels: Record<string, string> = {
  awaiting_confirmation: "Ожидает подтверждения",
  awaiting_delivery_terms: "Согласование доставки",
  cancelled: "Отменён",
  completed: "Завершён",
  processing: "В работе",
  ready: "Готов к выдаче",
};

function money(value: number) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(value / 100);
}

function confirmationStorageKey(orderId: string) {
  return `an30_checkout_confirmation:${orderId}`;
}

function storedConfirmation(orderId: string): CheckoutResponse | null {
  if (!UUID_PATTERN.test(orderId)) return null;
  const raw = window.sessionStorage.getItem(confirmationStorageKey(orderId));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as CheckoutResponse;
    return value.order?.id === orderId ? value : null;
  } catch {
    window.sessionStorage.removeItem(confirmationStorageKey(orderId));
    return null;
  }
}

export function CheckoutClient({
  checkoutEnabled,
  initialOrderId,
}: {
  checkoutEnabled: boolean;
  initialOrderId: string;
}) {
  const router = useRouter();
  const { clear, hydrated, items } = useCart();
  const [result, setResult] = useState<CheckoutResponse | null>(null);
  const [deliveryMethod, setDeliveryMethod] = useState<"needs_quote" | "pickup">("pickup");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(true);
  const [guest, setGuest] = useState(false);
  const [contact, setContact] = useState({ email: "", name: "", phone: "" });
  const [details, setDetails] = useState({ address: "", customerNote: "" });
  const [draftRead, setDraftRead] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const itemCount = useMemo(() => items.reduce((total, item) => total + item.quantity, 0), [items]);
  const products = useCartProducts(items);
  const cart = summariseCart(items, products);

  useEffect(() => {
    setOnline(navigator.onLine);
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  // The banner sits above the form and the button below it: bring a refusal
  // to the customer instead of leaving it off the screen.
  useEffect(() => {
    if (!error) return;
    errorRef.current?.scrollIntoView({ block: "center" });
    errorRef.current?.focus({ preventScroll: true });
  }, [error]);

  useEffect(() => {
    if (!draftRead) return;
    saveCheckoutDraft(checkoutDraftStorage(window), { ...contact, ...details, deliveryMethod });
  }, [contact, deliveryMethod, details, draftRead]);

  useEffect(() => {
    if (!initialOrderId) {
      const draft = readCheckoutDraft(checkoutDraftStorage(window));
      if (draft) {
        setContact({ email: draft.email, name: draft.name, phone: draft.phone });
        setDetails({ address: draft.address, customerNote: draft.customerNote });
        setDeliveryMethod(draft.deliveryMethod);
      }
      setDraftRead(true);
      void (async () => {
        try {
          const session = await readSession();
          setGuest(!session);
          if (session?.role === "customer") {
            const account = await apiRequest<AccountPrefill>("/account");
            setContact((current) => ({
              email: current.email || account.email,
              name: current.name || account.displayName || "",
              phone: current.phone || account.phone || "",
            }));
          }
        } catch {
          // Checkout remains available for a guest when session prefill fails.
        }
      })();
      return;
    }
    if (!UUID_PATTERN.test(initialOrderId)) {
      setError("Некорректный номер заказа в адресе страницы");
      return;
    }
    const stored = storedConfirmation(initialOrderId);
    if (stored) setResult(stored);
    else {
      void (async () => {
        try {
          const session = await readSession();
          if (!session || session.role !== "customer") throw new Error("Подтверждение гостевого заказа доступно только в браузере, где он был создан");
          const order = await apiRequest<{ id: string; publicNumber: string; status: string; subtotalKopeks: number; totalAmountKopeks: number }>(`/orders/${initialOrderId}`);
          setResult({ guestAccessToken: null, idempotentReplay: true, order });
        } catch (caught) { setError(errorText(caught)); }
      })();
    }
  }, [initialOrderId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true); setError("");
    const form = new FormData(event.currentTarget);
    const baseValue = {
      address: String(form.get("address") ?? ""), customerNote: String(form.get("customerNote") ?? ""),
      deliveryMethod, email: String(form.get("email") ?? ""), name: String(form.get("name") ?? ""),
      phone: String(form.get("phone") ?? ""),
    };
    const legalAcceptance = {
      personalDataConsent: form.get("personalDataConsent") === "on",
      termsAccepted: form.get("termsAccepted") === "on",
    };
    try {
      if (!legalAcceptance.termsAccepted || !legalAcceptance.personalDataConsent) {
        throw new Error("Примите оферту и отдельно подтвердите согласие на обработку данных");
      }
      const basePayload = checkoutPayload(
        baseValue,
        items,
        "00000000-0000-4000-8000-000000000000",
        legalAcceptance,
      );
      const { idempotencyKey: ignored, ...fingerprintPayload } = basePayload;
      void ignored;
      const idempotencyKey = await stableIdempotencyKey(window.sessionStorage, "checkout", fingerprintPayload);
      const body = checkoutPayload(baseValue, items, idempotencyKey, legalAcceptance);
      if (!body.items.length) throw new Error("Корзина пуста или содержит некорректные позиции");
      const session = await readSession();
      if (session && session.role !== "customer") throw new Error("Оформление клиента недоступно из учётной записи сотрудника");
      const checkout = await apiRequest<CheckoutResponse>(session ? "/checkout" : "/checkout/guest", { method: "POST", body });
      window.sessionStorage.setItem(confirmationStorageKey(checkout.order.id), JSON.stringify(checkout));
      clearIdempotencyKey(window.sessionStorage, "checkout");
      clearCheckoutDraft(checkoutDraftStorage(window));
      setDraftRead(false);
      clear();
      setResult(checkout);
      router.replace(`/checkout?order=${encodeURIComponent(checkout.order.id)}`);
    } catch (caught) {
      // Stock or price changed under the cart: show the cart what the catalog says now.
      if (caught instanceof StorefrontApiError && caught.status === 409) refreshCartProducts();
      setError(errorText(caught));
    } finally {
      setPending(false);
    }
  }

  if (result) {
    return (
      <div className={`${styles.page} ${styles.confirmationLayout}`}>
        <section>
          <p className={styles.eyebrow}>Заявка принята</p>
          <h1>{result.order.publicNumber}</h1>
          <p>Актуальная цена и наличие проверены. В заявке зафиксирована сумма {money(result.order.totalAmountKopeks)}.</p>
          <p className={styles.serverPriceNote}>{checkoutConfirmationMessage(computeShopStatusNow())}</p>
          <dl className={styles.confirmationFacts}>
            <div><dt>Статус</dt><dd>{orderStatusLabels[result.order.status] ?? result.order.status}</dd></div>
            <div><dt>Товары</dt><dd>{money(result.order.subtotalKopeks)}</dd></div>
          </dl>
          <div className={styles.heroActions}><Link className={styles.secondaryAction} href="/catalog">Вернуться в каталог</Link><Link className={styles.secondaryAction} href="/profile">Открыть заказы</Link></div>
        </section>
        <aside className={styles.checkoutAside}><h2>Что дальше</h2><p>Оплата не требуется на этом шаге: менеджер согласует с вами детали заказа по телефону. Для самовывоза дождитесь готовности заказа. Стоимость доставки, если она нужна, согласуется отдельно и не входит в сумму товаров.</p><p>Сохраните номер заказа для обращения в магазин.</p></aside>
      </div>
    );
  }

  if (!checkoutEnabled && !initialOrderId) {
    return (
      <div className={styles.page}>
        <header className={styles.pageTitle}>
          <h1>Оформление заказа готовится к запуску</h1>
          <p>Каталог и корзина доступны для проверки. Создание заявки откроется после публикации утверждённых юридических документов.</p>
        </header>
        <div className={styles.emptyState}>
          <h2>Корзина сохранена</h2>
          <p>Позиции останутся в этом браузере. Их можно изменить в каталоге.</p>
          <Link className={styles.primaryAction} href="/catalog">Вернуться в каталог</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.page} ${commerce.page}`}>
      <nav className={commerce.crumbs} aria-label="Хлебные крошки">
        <Link href="/">Главная</Link><span aria-hidden="true">/</span><Link href="/cart">Корзина</Link>
        <span aria-hidden="true">/</span><span aria-current="page">Оформление заказа</span>
      </nav>
      <header className={commerce.heading}><h1>Оформление заказа</h1></header>
      {!online ? <div className={styles.offlineNotice} role="status">Нет подключения к сети. Данные формы останутся на странице, но отправка недоступна.</div> : null}
      {error ? <div className={styles.formError} role="alert" ref={errorRef} tabIndex={-1}><strong>Заявка не создана</strong><p>{error}</p></div> : null}
      {!hydrated ? <div className={commerce.empty} role="status"><h2>Открываем корзину</h2></div> : itemCount === 0 ? (
        <section className={commerce.empty}><h2>Корзина пуста</h2><Link className={`${styles.primaryAction} ${commerce.action}`} href="/catalog">Перейти в каталог</Link></section>
      ) : (
        <div className={commerce.columns}>
          <form id="checkout-request" className={commerce.checkoutSteps} onSubmit={submit}>
            {guest ? <div className={`${commerce.panel} ${commerce.signIn}`}>
              <Person24Regular aria-hidden="true" /><p>Войдите, чтобы заполнить контакты из личного кабинета.</p><Link href="/auth?mode=login">Войти</Link>
            </div> : null}
            <section className={`${commerce.panel} ${commerce.step}`}>
              <fieldset className={commerce.stepFields}>
                <legend><span><i className={commerce.stepNumber} aria-hidden="true">1</i>Способ получения</span></legend>
                <div className={commerce.optionCards}>
                  <label className={commerce.option}>
                    <Location24Regular aria-hidden="true" /><span><strong>Самовывоз</strong><small>Из магазина АН‑30</small></span>
                    <input type="radio" name="deliveryMethod" value="pickup" checked={deliveryMethod === "pickup"} onChange={() => setDeliveryMethod("pickup")} />
                  </label>
                  <label className={commerce.option}>
                    <VehicleTruck24Regular aria-hidden="true" /><span><strong>Доставка</strong><small>Условия уточнит менеджер</small></span>
                    <input type="radio" name="deliveryMethod" value="needs_quote" checked={deliveryMethod === "needs_quote"} onChange={() => setDeliveryMethod("needs_quote")} />
                  </label>
                </div>
                {deliveryMethod === "needs_quote" ? <label className={styles.field}>Адрес доставки<textarea name="address" required minLength={5} maxLength={1000} autoComplete="street-address" value={details.address} onChange={(event) => setDetails((current) => ({ ...current, address: event.target.value }))} /></label> : null}
              </fieldset>
            </section>

            <section className={`${commerce.panel} ${commerce.step}`}>
              <fieldset className={commerce.stepFields}>
                <legend><span><i className={commerce.stepNumber} aria-hidden="true">2</i>Контактные данные</span></legend>
                <div className={commerce.contactGrid}>
                  <label className={styles.field}>Имя<input name="name" required minLength={2} maxLength={160} value={contact.name} onChange={(event) => setContact((current) => ({ ...current, name: event.target.value }))} autoComplete="name" /></label>
                  <label className={styles.field}>Email<EmailField name="email" required maxLength={254} value={contact.email} onChange={(email) => setContact((current) => ({ ...current, email }))} /></label>
                  <label className={styles.field}>Телефон<PhoneField name="phone" required value={contact.phone} onChange={(phone) => setContact((current) => ({ ...current, phone }))} /></label>
                </div>
              </fieldset>
            </section>

            <section className={`${commerce.panel} ${commerce.step}`}>
              <fieldset className={commerce.stepFields}>
                <legend><span><i className={commerce.stepNumber} aria-hidden="true">3</i>Подтверждение</span></legend>
                <p className={commerce.notice}>Оплату и получение согласует менеджер после заявки.</p>
                <label className={styles.field}>Комментарий к заказу<textarea name="customerNote" maxLength={2000} placeholder="Например, удобное время звонка" value={details.customerNote} onChange={(event) => setDetails((current) => ({ ...current, customerNote: event.target.value }))} /></label>
                <label className={commerce.consent}><input name="termsAccepted" type="checkbox" required /><span>Я принимаю <Link href="/terms" target="_blank">условия публичной оферты</Link>.</span></label>
                <label className={commerce.consent}><input name="personalDataConsent" type="checkbox" required /><span>{CHECKOUT_PERSONAL_DATA_CONSENT_TEXT} <Link href="/checkout-personal-data-consent" target="_blank">Открыть документ</Link>.</span></label>
              </fieldset>
            </section>
          </form>

          <aside className={`${commerce.panel} ${commerce.summary}`} aria-labelledby="checkout-cart-title">
            <h2 id="checkout-cart-title">Ваш заказ</h2>
            <ul className={commerce.orderRows}>{cart.lines.map((line, index) => (
              <li className={commerce.orderRow} key={line.productId}>
                <CartLineThumbnail line={line} />
                <div className={commerce.lineIdentity}>
                  <CartLineIdentity line={line} position={index + 1} />
                  <small className={commerce.linePhotoNote}>Фото — в карточке товара</small>
                </div>
                <span className={commerce.lineTotal}>{line.quantity} шт. · {line.subtotalKopeks === null ? "Цена уточняется" : formatRubles(line.subtotalKopeks)}</span>
              </li>
            ))}</ul>
            <div className={commerce.grandTotal}>
              <span>Предварительно</span>
              <strong>{cart.pricesComplete ? formatRubles(cart.knownSubtotalKopeks) : cart.knownSubtotalKopeks > 0 ? `от ${formatRubles(cart.knownSubtotalKopeks)}` : "Уточняется"}</strong>
            </div>
            <Link className={commerce.remove} href="/cart">Изменить корзину</Link>
            {cart.hasUnavailable ? <p className={commerce.notice} role="status">Удалите недоступные позиции в корзине.</p>
              : cart.hasOverStock ? <p className={commerce.notice} role="status">В корзине больше, чем есть в наличии. Уменьшите количество в корзине.</p> : null}
            <button className={`${styles.submitButton} ${commerce.action}`} form="checkout-request" type="submit" disabled={pending || !online || cart.hasUnavailable || cart.hasOverStock}>{pending ? "Отправляем заявку…" : "Отправить заявку"}</button>
          </aside>
        </div>
      )}
    </div>
  );
}
