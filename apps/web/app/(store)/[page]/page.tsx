import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { JsonLd } from "../_components/json-ld";
import { ContentPageFrame, FactCards, StepRow } from "../_components/content-page";
import frame from "../_components/content-page.module.css";
import { storeContentPages } from "../_lib/legacy-pages";
import { breadcrumbJsonLd, pageMetadata, privatePageMetadata } from "../_lib/seo";
import { STORE_HOURS, STORE_LOCALITY, STORE_MAP_URL, STORE_STREET } from "../../site-config";

interface LegacyPageProps {
  params: Promise<{ page: string }>;
}

export function generateStaticParams() {
  return Object.keys(storeContentPages).map((page) => ({ page }));
}

export async function generateMetadata({ params }: LegacyPageProps): Promise<Metadata> {
  const { page } = await params;
  const content = storeContentPages[page];
  if (!content) return privatePageMetadata("Страница не найдена", "Запрошенная страница отсутствует на сайте АН-30.");
  return pageMetadata({ description: content.intro, path: `/${page}`, title: content.title });
}

const DOCUMENT_PAGES = new Set([
  "privacy",
  "terms",
  "checkout-personal-data-consent",
  "contact-personal-data-consent",
  "supplier-waitlist-personal-data-consent",
]);
const COMPANY_PAGES = new Set(["about", "careers", "map"]);

export default async function LegacyPage({ params }: LegacyPageProps) {
  const { page } = await params;
  const content = storeContentPages[page];
  if (!content) notFound();
  const isDocument = DOCUMENT_PAGES.has(page);
  const trail = isDocument ? "Документы" : COMPANY_PAGES.has(page) ? "О компании" : "Покупателям";

  return (
    <>
      <JsonLd value={breadcrumbJsonLd([{ name: "Главная", path: "/" }, { name: content.title, path: `/${page}` }])} />
      <ContentPageFrame
        facts={page === "delivery" ? (
          <FactCards items={[
            {
              action: { external: true, href: STORE_MAP_URL, label: "Построить маршрут" },
              label: "Самовывоз · бесплатно",
              text: `${STORE_HOURS}. Приходите после сообщения о готовности.`,
              title: `${STORE_LOCALITY}, ${STORE_STREET}`,
            },
            {
              label: "Доставка",
              text: "Цена и срок зависят от адреса, размера товара и перевозчика. Менеджер сообщит их до отправки.",
              title: "Согласуем заранее",
            },
            {
              label: "Оплата",
              text: "На сайте оплатить нельзя. Способ оплаты менеджер назовёт, когда подтвердит заказ.",
              title: "После подтверждения",
            },
          ]} />
        ) : undefined}
        intro={content.intro}
        sections={content.sections}
        title={content.title}
        trail={trail}
        variant={isDocument ? "document" : "info"}
      >
        {page === "delivery" ? (
          <StepRow
            steps={[
              { text: "В корзине на сайте или по телефону", title: "Оформите заказ" },
              { text: "Проверим наличие, цену и способ получения", title: "Дождитесь звонка" },
              { text: "Напишем, когда заказ готов к выдаче", title: "Получите сообщение" },
              { text: "В магазине или у перевозчика", title: "Заберите заказ" },
            ]}
            title="Как получить заказ"
          />
        ) : null}
        {content.mapEmbed ? (
          <iframe
            className={frame.map}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            src={content.mapEmbed.src}
            title={content.mapEmbed.title}
          />
        ) : null}
      </ContentPageFrame>
    </>
  );
}
