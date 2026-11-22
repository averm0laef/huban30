import type { Metadata } from "next";
import Link from "next/link";

import { ContactRequestForm } from "../_components/contact-request-form";
import frame from "../_components/content-page.module.css";
import { JsonLd } from "../_components/json-ld";
import { MessengerIcon } from "../_components/messenger-icon";
import { ShopOpenLine } from "../_components/shop-open-line";
import { OWNER_LEGAL_DETAILS, storeContentPages } from "../_lib/legacy-pages";
import { organizationJsonLd, pageMetadata } from "../_lib/seo";
import { MESSENGERS, STORE_HOURS, STORE_LOCALITY, STORE_MAP_URL, STORE_PHONE, STORE_PHONE_DISPLAY, STORE_STREET } from "../../site-config";

export const metadata: Metadata = pageMetadata({
  description: "Адрес, телефон, мессенджеры и форма обращения магазина автозапчастей АН-30 в Чернышевске.",
  path: "/contacts",
  title: "Контакты",
});

const QUICK_LINKS = [
  { href: "/podbor", text: "По марке, модели или VIN", title: "Подобрать деталь" },
  { href: "/chat", text: "Ответит сотрудник магазина", title: "Написать в чат" },
  { href: "#contact-form", text: "Перезвоним или ответим на email", title: "Оставить обращение" },
];

export default function ContactsPage() {
  const dataCollectionEnabled = process.env.LEGAL_DOCUMENTS_APPROVED === "true";
  const map = storeContentPages.map?.mapEmbed;
  return (
    <div className={frame.page}>
      <JsonLd value={organizationJsonLd()} />
      <nav aria-label="Хлебные крошки" className={frame.breadcrumbs}>
        <Link href="/">Главная</Link><span aria-hidden="true">›</span><span aria-current="page">Контакты</span>
      </nav>
      <header className={frame.header}>
        <h1>Контакты</h1>
        <p>Магазин автозапчастей АН-30 в {STORE_LOCALITY === "Чернышевск" ? "Чернышевске" : STORE_LOCALITY}. Подскажем по наличию, заказу и подбору детали.</p>
      </header>

      <div className={frame.contactGrid}>
        <section aria-labelledby="contact-store-title" className={frame.contactCard}>
          <h2 className={frame.visuallyHidden} id="contact-store-title">Магазин</h2>
          <ShopOpenLine />
          <dl className={frame.contactList}>
            <div><dt>Адрес</dt><dd>{STORE_LOCALITY}, {STORE_STREET}</dd></div>
            <div><dt>Режим работы</dt><dd>{STORE_HOURS}</dd></div>
            <div><dt>Телефон</dt><dd><a href={`tel:${STORE_PHONE}`}>{STORE_PHONE_DISPLAY}</a></dd></div>
          </dl>
          <div className={frame.contactActions}>
            <a className={frame.factAction} href={STORE_MAP_URL} rel="noreferrer" target="_blank">Построить маршрут</a>
            <a className={frame.outlineAction} href={`tel:${STORE_PHONE}`}>Позвонить</a>
          </div>
          <div className={frame.messengers}>
            <span>Мессенджеры</span>
            <ul>
              {MESSENGERS.map((messenger) => (
                <li key={messenger.id}>
                  <a href={messenger.href} rel="noreferrer" target="_blank"><MessengerIcon id={messenger.id} />{messenger.label}</a>
                </li>
              ))}
            </ul>
          </div>
        </section>
        {map ? (
          <iframe className={frame.map} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" src={map.src} title={map.title} />
        ) : null}
      </div>

      <nav aria-label="Быстрые действия" className={frame.quickLinks}>
        {QUICK_LINKS.map((link) => (
          <Link href={link.href} key={link.href}><strong>{link.title}</strong><span>{link.text}</span></Link>
        ))}
      </nav>

      <section className={frame.formCard} id="contact-form">
        <ContactRequestForm enabled={dataCollectionEnabled} source="contacts" title="Оставить обращение" description="Опишите вопрос — ответим по телефону или на email." />
      </section>

      <section aria-labelledby="requisites-title" className={frame.card}>
        <h2 id="requisites-title">Реквизиты продавца</h2>
        <p>{OWNER_LEGAL_DETAILS}</p>
      </section>
    </div>
  );
}
