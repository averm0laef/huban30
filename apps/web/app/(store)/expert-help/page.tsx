import type { Metadata } from "next";
import Link from "next/link";

import { MESSENGERS, STORE_HOURS, STORE_PHONE, STORE_PHONE_DISPLAY } from "../../site-config";
import { ContactRequestForm } from "../_components/contact-request-form";
import { MessengerIcon } from "../_components/messenger-icon";
import { ShopOpenLine } from "../_components/shop-open-line";
import storeStyles from "../_components/storefront.module.css";
import styles from "./expert-help.module.css";

export const metadata: Metadata = {
  title: "Помощь специалиста",
  description: "Менеджер АН-30 подберёт автозапчасть по VIN или марке и модели: артикул, цена и срок. Бесплатно и без регистрации.",
};

const STEPS = [
  { title: "Автомобиль", text: "VIN или марка, модель и год. VIN надёжнее всего." },
  { title: "Что нужно", text: "Название, артикул или фото старой детали — подойдёт всё." },
  { title: "Ответ менеджера", text: "Артикул, цена и срок. Оформим заказ или отложим в магазине." },
];

const VIN_PLACES = [
  "В свидетельстве о регистрации (СТС) — строка «Идентификационный номер (VIN)»",
  "В ПТС или электронном ПТС",
  "На табличке в проёме водительской двери или под лобовым стеклом слева",
];

function ChatIcon() {
  return <svg aria-hidden="true" fill="none" height="22" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="22"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>;
}
function PhoneIcon() {
  return <svg aria-hidden="true" fill="none" height="22" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="22"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg>;
}

/** Design board «Помощь специалиста»: ways to ask first, then how it works, VIN tips and the form. */
export default function ExpertHelpPage() {
  const dataCollectionEnabled = process.env.LEGAL_DOCUMENTS_APPROVED === "true";
  return (
    <div className={`${storeStyles.page} ${styles.page}`}>
      <nav aria-label="Навигационная цепочка" className={styles.breadcrumbs}>
        <Link href="/">Главная</Link><span aria-hidden="true">·</span><span aria-current="page">Помощь специалиста</span>
      </nav>

      <section aria-labelledby="expert-title" className={styles.hero}>
        <div className={styles.heroText}>
          <span className={styles.eyebrow}>Помощь специалиста</span>
          <h1 id="expert-title">Подберём запчасть под ваш автомобиль</h1>
          <p className={styles.lead}>Менеджер проверит совместимость по VIN и каталогам производителя, назовёт артикул, цену и срок. Бесплатно и без регистрации.</p>
          <div className={styles.heroStatus}><ShopOpenLine /></div>
        </div>
        <div className={styles.ways}>
          <Link className={`${styles.way} ${styles.wayPrimary}`} href="/chat">
            <span className={styles.wayIcon}><ChatIcon /></span>
            <span><strong>Написать в чат</strong><small>Ответ здесь же, на сайте</small></span>
          </Link>
          <a className={styles.way} href={`tel:${STORE_PHONE}`}>
            <span className={styles.wayIcon}><PhoneIcon /></span>
            <span><strong>{STORE_PHONE_DISPLAY}</strong><small>Позвонить · {STORE_HOURS.toLowerCase()}</small></span>
          </a>
          <div className={`${styles.way} ${styles.wayMessengers}`}>
            <span><strong>В мессенджере</strong><small>Пришлите фото детали или СТС</small></span>
            <span className={styles.messengerRow}>
              {MESSENGERS.map((messenger) => (
                <a aria-label={messenger.label} href={messenger.href} key={messenger.id} rel="noopener noreferrer" target="_blank">
                  <MessengerIcon id={messenger.id} />
                </a>
              ))}
            </span>
          </div>
        </div>
      </section>

      <section aria-labelledby="expert-steps" className={styles.steps}>
        <h2 id="expert-steps">Как это работает</h2>
        <ol>
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <span aria-hidden="true" className={styles.stepNumber}>{index + 1}</span>
              <span><strong>{step.title}</strong><span>{step.text}</span></span>
            </li>
          ))}
        </ol>
      </section>

      <div className={styles.columns}>
        <section aria-labelledby="expert-vin" className={styles.vinCard}>
          <h2 id="expert-vin">Где найти VIN</h2>
          <p>17 знаков: латинские буквы и цифры. Можно просто сфотографировать СТС и прислать в чат.</p>
          <ul>
            {VIN_PLACES.map((place) => <li key={place}>{place}</li>)}
          </ul>
          <p className={styles.note}>Паспортные и банковские данные не нужны — только автомобиль и деталь.</p>
          <Link className={styles.selfService} href="/podbor">
            <span><strong>Хотите сами?</strong><small>Подбор по VIN, марке и модели</small></span>
            <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" viewBox="0 0 24 24" width="18"><path d="m9 18 6-6-6-6" /></svg>
          </Link>
        </section>
        <ContactRequestForm
          className={styles.formCard}
          description="Если удобнее, чтобы вам перезвонили или написали."
          disabledFallback={
            <div className={styles.formOff} role="status">
              <strong>Заявка через сайт скоро заработает</strong>
              <span>Пока самый быстрый способ — чат: менеджер ответит здесь же, на сайте. Или позвоните.</span>
              <span className={styles.formOffActions}>
                <Link className={styles.primaryButton} href="/chat">Написать в чат</Link>
                <a className={styles.secondaryButton} href={`tel:${STORE_PHONE}`}>Позвонить</a>
              </span>
            </div>
          }
          enabled={dataCollectionEnabled}
          messagePlaceholder="Например: Toyota Corolla 2012, VIN JTD… Нужны передние тормозные колодки"
          source="vin_request"
          title="Оставить заявку"
        />
      </div>
    </div>
  );
}
