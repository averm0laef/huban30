"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import { summariseCart, useCartProducts } from "../_lib/cart-products";
import { formatRubles } from "../_lib/catalog-format";
import { checkoutPayload } from "../_lib/checkout";
import { clearIdempotencyKey, stableIdempotencyKey } from "../_lib/idempotency";
import { apiRequest, errorText, readSession } from "../_lib/storefront-api";
import { CartLineIdentity } from "./cart-actions";
import { useCart } from "./cart-provider";
import styles from "./storefront.module.css";

interface CheckoutResponse {
  guestAccessToken: string | null;
  idempotentReplay: boolean;
  order: { id: string; publicNumber: string; status: string; subtotalKopeks: number; totalAmountKopeks: number };
  payment: {
    amountKopeks: number;
    confirmationToken: string | null;
    confirmationUrl: string;
    externalPaymentId: string;
    id: string;
    provider: string;
    status: string;
  };
  reservation: { expiresAt: string; id: string };
}

interface AccountPrefill { displayName: string | null; email: string; phone: string | null }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const orderStatusLabels: Record<string, string> = {
  cancelled: "Отменён",
  completed: "Завершён",
  paid: "Оплачен",
  pending_payment: "Ожидает оплаты",
  processing: "В работе",
  ready: "Готов к выдаче",
  refunded: "Возвращён",
};
const paymentStatusLabels: Record<string, string> = {
  cancelled: "Отменён",
  failed: "Ошибка",
  pending: "Ожидает подтверждения",
  succeeded: "Оплачен",
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
  const { clear, hydrated, items, removeItem, updateQuantity } = useCart();
  const [result, setResult] = useState<CheckoutResponse | null>(null);
  const [deliveryMethod, setDeliveryMethod] = useState<"needs_quote" | "pickup">("pickup");
  const [pending, setPending] = useState(false);
  const [paymentPending, setPaymentPending] = useState(false);
  const [error, setError] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [online, setOnline] = useState(true);
  const [contact, setContact] = useState({ email: "", name: "", phone: "" });
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

  useEffect(() => {
    if (!initialOrderId) {
      void (async () => {
        try {
          const session = await readSession();
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
          const order = await apiRequest<{ id: string; publicNumber: string; status: string; subtotalKopeks: number; totalAmountKopeks: number; payments: Array<{ amountKopeks: number; id: string; provider: string; status: string }> }>(`/orders/${initialOrderId}`);
          const payment = order.payments[0];
          if (!payment) throw new Error("В заказе не найден платёж");
          setResult({ guestAccessToken: null, idempotentReplay: true, order, payment: { ...payment, confirmationToken: null, confirmationUrl: "", externalPaymentId: "" }, reservation: { expiresAt: "", id: "" } });
        } catch (caught) { setError(errorText(caught)); }
      })();
    }
  }, [initialOrderId]);

  async function confirmSandbox(checkout: CheckoutResponse) {
    if (checkout.payment.provider !== "sandbox" || !checkout.payment.confirmationToken || !checkout.payment.confirmationUrl) return;
    setPaymentPending(true); setPaymentError("");
    try {
      const completed = await apiRequest<{ status: string; timedOut?: boolean }>(checkout.payment.confirmationUrl, {
        method: "POST", body: { confirmationToken: checkout.payment.confirmationToken },
      });
      setPaymentStatus(completed.timedOut ? "Платёж пока ожидает подтверждения" : completed.status === "succeeded" ? "Оплата подтверждена" : `Статус платежа: ${completed.status}`);
    } catch (caught) {
      setPaymentError(errorText(caught));
    } finally {
      setPaymentPending(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true); setError(""); setPaymentError(""); setPaymentStatus("");
    const form = new FormData(event.currentTarget);
    const baseValue = {
      address: String(form.get("address") ?? ""), customerNote: String(form.get("customerNote") ?? ""),
      deliveryMethod, email: String(form.get("email") ?? ""), name: String(form.get("name") ?? ""),
      phone: String(form.get("phone") ?? ""),
    };
    try {
      const basePayload = checkoutPayload(baseValue, items, "00000000-0000-4000-8000-000000000000");
      const { idempotencyKey: ignored, ...fingerprintPayload } = basePayload;
      void ignored;
      const idempotencyKey = await stableIdempotencyKey(window.sessionStorage, "checkout", fingerprintPayload);
      const body = checkoutPayload(baseValue, items, idempotencyKey);
      if (!body.items.length) throw new Error("Корзина пуста или содержит некорректные позиции");
      const session = await readSession();
      if (session && session.role !== "customer") throw new Error("Оформление клиента недоступно из учётной записи сотрудника");
      const checkout = await apiRequest<CheckoutResponse>(session ? "/checkout" : "/checkout/guest", { method: "POST", body });
      window.sessionStorage.setItem(confirmationStorageKey(checkout.order.id), JSON.stringify(checkout));
      clearIdempotencyKey(window.sessionStorage, "checkout");
      clear();
      setResult(checkout);
      router.replace(`/checkout?order=${encodeURIComponent(checkout.order.id)}`);
      await confirmSandbox(checkout);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPending(false);
    }
  }

  if (result) {
    return (
      <div className={`${styles.page} ${styles.confirmationLayout}`}>
        <section>
          <p className={styles.eyebrow}>Заказ создан</p>
          <h1>{result.order.publicNumber}</h1>
          <p>Цена и остаток подтверждены сервером. В заказе зафиксирована сумма {money(result.order.totalAmountKopeks)}.</p>
          <dl className={styles.confirmationFacts}>
            <div><dt>Статус заказа</dt><dd>{orderStatusLabels[result.order.status] ?? result.order.status}</dd></div>
            <div><dt>Товары</dt><dd>{money(result.order.subtotalKopeks)}</dd></div>
            <div><dt>Платёж</dt><dd>{paymentStatus || paymentStatusLabels[result.payment.status] || result.payment.status}</dd></div>
            {result.reservation.expiresAt ? <div><dt>Резерв до</dt><dd>{new Date(result.reservation.expiresAt).toLocaleString("ru-RU")}</dd></div> : null}
          </dl>
          {paymentError ? <div className={styles.formError} role="alert"><strong>Заказ сохранён, но платёж не подтверждён</strong><p>{paymentError}</p></div> : null}
          {result.payment.confirmationToken && !paymentStatus ? <button className={styles.primaryAction} type="button" disabled={paymentPending || !online} onClick={() => void confirmSandbox(result)}>{paymentPending ? "Подтверждаем..." : "Повторить подтверждение оплаты"}</button> : null}
          <div className={styles.heroActions}><Link className={styles.secondaryAction} href="/catalog">Вернуться в каталог</Link><Link className={styles.secondaryAction} href="/profile">Открыть заказы</Link></div>
        </section>
        <aside className={styles.checkoutAside}><h2>Что дальше</h2><p>Для самовывоза дождитесь готовности заказа. Стоимость доставки, если она нужна, согласуется отдельно и не входит в сумму товаров.</p><p>Сохраните номер заказа для обращения в магазин.</p></aside>
      </div>
    );
  }

  if (!checkoutEnabled && !initialOrderId) {
    return (
      <div className={styles.page}>
        <header className={styles.pageTitle}>
          <h1>Оформление заказа готовится к запуску</h1>
          <p>Каталог и корзина доступны для проверки. Создание заказа откроется после подключения оплаты и публикации утверждённых юридических документов.</p>
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
    <div className={styles.page}>
      <header className={styles.pageTitle}><h1>Оформление заказа</h1><p>Браузер передаёт только идентификаторы и количество. Цена, остаток и резерв проверяются сервером.</p></header>
      {!online ? <div className={styles.offlineNotice} role="status">Нет подключения к сети. Данные формы останутся на странице, но отправка недоступна.</div> : null}
      {error ? <div className={styles.formError} role="alert"><strong>Заказ не создан</strong><p>{error}</p><p>Исправьте данные или повторите отправку. Повтор использует тот же ключ и не создаст второй заказ.</p></div> : null}
      {!hydrated ? <div className={styles.loadingState} role="status"><h2>Открываем корзину</h2><p>Читаем сохранённые позиции.</p></div> : itemCount === 0 ? (
        <div className={styles.emptyState}><h2>Корзина пуста</h2><p>Добавьте хотя бы один товар. Цена и доступность будут проверены при оформлении.</p><Link className={styles.primaryAction} href="/catalog">Перейти в каталог</Link></div>
      ) : (
        <div className={styles.checkoutLayout}>
          <form className={styles.checkoutForm} onSubmit={submit}>
            <fieldset><legend>1. Контактные данные</legend>
              <label className={styles.field}>Имя<input name="name" required minLength={2} maxLength={160} value={contact.name} onChange={(event) => setContact((current) => ({ ...current, name: event.target.value }))} autoComplete="name" /></label>
              <label className={styles.field}>Email<input name="email" type="email" required maxLength={254} value={contact.email} onChange={(event) => setContact((current) => ({ ...current, email: event.target.value }))} autoComplete="email" /></label>
              <label className={styles.field}>Телефон<input name="phone" type="tel" required pattern="\+[1-9][0-9]{6,14}" placeholder="+79240000000" value={contact.phone} onChange={(event) => setContact((current) => ({ ...current, phone: event.target.value }))} autoComplete="tel" /></label>
            </fieldset>
            <fieldset><legend>2. Получение</legend>
              <label className={styles.radioField}><input type="radio" name="deliveryMethod" value="pickup" checked={deliveryMethod === "pickup"} onChange={() => setDeliveryMethod("pickup")} /> Самовывоз из магазина</label>
              <label className={styles.radioField}><input type="radio" name="deliveryMethod" value="needs_quote" checked={deliveryMethod === "needs_quote"} onChange={() => setDeliveryMethod("needs_quote")} /> Нужна доставка, условия согласует менеджер</label>
              {deliveryMethod === "needs_quote" ? <label className={styles.field}>Адрес доставки<textarea name="address" required minLength={5} maxLength={1000} autoComplete="street-address" /></label> : null}
            </fieldset>
            <fieldset><legend>3. Комментарий</legend><label className={styles.field}>Комментарий к заказу<textarea name="customerNote" maxLength={2000} placeholder="Например, удобное время звонка" /></label></fieldset>
            <label className={styles.checkboxField}><input name="terms" type="checkbox" required /> Я принимаю <Link href="/terms" target="_blank">условия работы</Link> и ознакомился с <Link href="/privacy" target="_blank">политикой конфиденциальности</Link>.</label>
            <button className={styles.submitButton} type="submit" disabled={pending || !online}>{pending ? "Проверяем и резервируем..." : "Создать заказ"}</button>
          </form>
          <aside className={styles.checkoutAside} aria-labelledby="checkout-cart-title">
            <h2 id="checkout-cart-title">Корзина · {itemCount} шт.</h2>
            {cart.hasUnavailable ? <p className={styles.serverPriceNote} role="status">Часть позиций снята с продажи. Удалите их, иначе сервер отклонит заказ.</p> : null}
            <div className={styles.checkoutLines}>{cart.lines.map((line, index) => (
              <div key={line.productId}>
                <CartLineIdentity line={line} position={index + 1} />
                <label>Количество<input type="number" min={1} max={100} value={line.quantity} onChange={(event) => updateQuantity(line.productId, Number(event.target.value))} /></label>
                <span className={styles.checkoutLineTotal}>{line.subtotalKopeks === null ? "Цена уточняется" : formatRubles(line.subtotalKopeks)}</span>
                <button type="button" onClick={() => removeItem(line.productId)}>Удалить</button>
              </div>
            ))}</div>
            <p className={styles.checkoutSubtotal}>
              <span>Предварительно</span>
              <strong>{formatRubles(cart.knownSubtotalKopeks)}{cart.pricesComplete ? "" : " и выше"}</strong>
            </p>
            <p className={styles.serverPriceNote}>Это ориентир по текущему каталогу. Итоговая сумма фиксируется только после проверки актуальной цены и остатка на сервере.</p>
          </aside>
        </div>
      )}
    </div>
  );
}
