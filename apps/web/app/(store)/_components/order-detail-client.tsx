"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiRequest, errorText, readSession } from "../_lib/storefront-api";
import styles from "./storefront.module.css";

interface OrderDetail {
  createdAt: string;
  customerNote: string | null;
  delivery: unknown;
  id: string;
  items: Array<{ id: string; lineTotalKopeks: number; name: string; quantity: number; sku: string; unitPriceKopeks: number }>;
  publicNumber: string;
  status: string;
  subtotalKopeks: number;
  totalAmountKopeks: number;
}

const orderLabels: Record<string, string> = {
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

export function OrderDetailClient({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const session = await readSession();
        if (!session) throw new Error("Войдите, чтобы открыть заказ");
        const result = await apiRequest<OrderDetail>(`/orders/${encodeURIComponent(orderId)}`);
        if (active) setOrder(result);
      } catch (caught) {
        if (active) setError(errorText(caught));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [orderId]);

  return (
    <div className={styles.page}>
      <nav className={styles.breadcrumbs} aria-label="Хлебные крошки">
        <Link href="/profile">Личный кабинет</Link><span>/</span><span>Заказ</span>
      </nav>
      {loading ? <div className={styles.loadingState} role="status"><h1>Загружаем заказ</h1><p>Проверяем доступ к данным.</p></div> : null}
      {!loading && error ? <div className={styles.errorState} role="alert"><h1>Заказ не открыт</h1><p>{error}</p><Link className={styles.secondaryAction} href="/profile">Вернуться в кабинет</Link></div> : null}
      {order ? (
        <article>
          <header className={styles.orderHeading}>
            <div><p className={styles.eyebrow}>Заказ</p><h1>{order.publicNumber}</h1><p>Создан {new Date(order.createdAt).toLocaleString("ru-RU")}</p></div>
            <strong className={styles.statusBadge}>{orderLabels[order.status] ?? order.status}</strong>
          </header>
          {order.status === "awaiting_confirmation" ? (
            <p className={styles.serverPriceNote}>Заявка передана менеджеру. Мы позвоним вам, чтобы подтвердить заказ.</p>
          ) : null}
          <section className={styles.detailSection} aria-labelledby="order-items">
            <h2 id="order-items">Состав заказа</h2>
            <div className={styles.lineList}>
              {order.items.map((item) => (
                <div key={item.id} className={styles.orderLine}>
                  <div><strong>{item.name}</strong><small>Артикул {item.sku}</small></div>
                  <span>{item.quantity} шт.</span><span>{money(item.unitPriceKopeks)}</span><strong>{money(item.lineTotalKopeks)}</strong>
                </div>
              ))}
            </div>
            <dl className={styles.orderTotals}>
              <div><dt>Товары</dt><dd>{money(order.subtotalKopeks)}</dd></div>
              <div><dt>Итого</dt><dd>{money(order.totalAmountKopeks)}</dd></div>
            </dl>
          </section>
        </article>
      ) : null}
    </div>
  );
}
