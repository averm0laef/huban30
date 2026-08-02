import type { Metadata } from "next";
import Link from "next/link";

import { JsonLd } from "./_components/json-ld";
import styles from "./_components/storefront.module.css";
import { organizationJsonLd, pageMetadata } from "./_lib/seo";

export const metadata: Metadata = pageMetadata({
  description: "Автозапчасти в Чернышевске: подбор по названию и артикулу, цены и остатки из 1С, проверка совместимости сотрудником магазина.",
  path: "/",
  title: "Автозапчасти в Чернышевске",
});

export default function StorefrontPage() {
  return (
    <div className={styles.home}>
      <JsonLd value={organizationJsonLd()} />
      <section className={styles.homeHero}>
        <div>
          <h1>Нужная запчасть без лишней переписки</h1>
          <p>Ищите по названию или артикулу. Цена и остаток поступают из 1С и проверяются сервером перед оформлением.</p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryAction} href="/catalog">Открыть каталог</Link>
            <Link className={styles.secondaryAction} href="/contacts">Связаться с магазином</Link>
          </div>
        </div>
        <aside className={styles.storeCard} aria-labelledby="store-card-title">
          <h2 id="store-card-title">Магазин в Чернышевске</h2>
          <p>Поможем проверить совместимость детали по автомобилю и артикулу.</p>
          <dl className={styles.storeFacts}>
            <div><dt>Режим работы</dt><dd>09:00-19:00</dd></div>
            <div><dt>Телефон</dt><dd><a href="tel:+79244742605">+7 (924) 474-26-05</a></dd></div>
            <div><dt>Получение</dt><dd>В магазине</dd></div>
          </dl>
        </aside>
      </section>

      <section className={styles.serviceStrip} aria-labelledby="service-title">
        <h2 id="service-title">Подбор по автомобилю и артикулу</h2>
        <p>Сотрудник проверит совместимость и согласует получение. Браузер не определяет цену заказа и не резервирует остаток.</p>
      </section>
    </div>
  );
}
