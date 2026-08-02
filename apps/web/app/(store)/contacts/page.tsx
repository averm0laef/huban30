import type { Metadata } from "next";

import { ContactRequestForm } from "../_components/contact-request-form";
import { JsonLd } from "../_components/json-ld";
import styles from "../_components/storefront.module.css";
import { organizationJsonLd, pageMetadata } from "../_lib/seo";

export const metadata: Metadata = pageMetadata({
  description: "Адрес, телефон и защищённая форма обращения магазина автозапчастей АН-30 в Чернышевске.",
  path: "/contacts",
  title: "Контакты",
});

export default function ContactsPage() {
  const dataCollectionEnabled = process.env.LEGAL_DOCUMENTS_APPROVED === "true";
  return (
    <div className={styles.page}>
      <JsonLd value={organizationJsonLd()} />
      <header className={styles.pageTitle}><h1>Связаться с АН-30</h1><p>Ответим по наличию, заказу или работе магазина. Для подбора сложной детали лучше использовать форму специалиста.</p></header>
      <div className={styles.contactLayout}>
        <section className={styles.contactDetails} aria-labelledby="contact-details-title">
          <p className={styles.eyebrow}>Магазин</p><h2 id="contact-details-title">Чернышевск</h2>
          <dl>
            <div><dt>Адрес</dt><dd>ул. Куйбышева, 118А</dd></div>
            <div><dt>Режим</dt><dd>Ежедневно с 09:00 до 19:00</dd></div>
            <div><dt>Телефон</dt><dd><a href="tel:+79244742605">+7 (924) 474-26-05</a></dd></div>
          </dl>
          <div className={styles.contactLinks}><a href="https://yandex.ru/maps/?text=%D0%A7%D0%B5%D1%80%D0%BD%D1%8B%D1%88%D0%B5%D0%B2%D1%81%D0%BA%2C%20%D1%83%D0%BB.%20%D0%9A%D1%83%D0%B9%D0%B1%D1%8B%D1%88%D0%B5%D0%B2%D0%B0%2C%20118%D0%90" target="_blank" rel="noreferrer">Открыть маршрут</a><a href="https://t.me/an30_autoparts" target="_blank" rel="noreferrer">Telegram</a><a href="https://vk.com/an30_autoparts" target="_blank" rel="noreferrer">ВКонтакте</a></div>
        </section>
        <ContactRequestForm enabled={dataCollectionEnabled} source="contacts" title="Оставить обращение" description="Опишите вопрос. Повторная отправка после сбоя не создаст дубль." />
      </div>
    </div>
  );
}
