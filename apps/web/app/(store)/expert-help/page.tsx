import type { Metadata } from "next";

import { ContactRequestForm } from "../_components/contact-request-form";
import styles from "../_components/storefront.module.css";

export const metadata: Metadata = {
  title: "Помощь специалиста",
  description: "Запросить проверку совместимости и подбор автозапчасти у специалиста АН-30.",
};

export default function ExpertHelpPage() {
  const dataCollectionEnabled = process.env.LEGAL_DOCUMENTS_APPROVED === "true";
  return (
    <div className={styles.page}>
      <header className={styles.pageTitle}><h1>Подбор без догадок</h1><p>Передайте данные автомобиля и нужной детали. Специалист проверит совместимость по доступным каталогам и данным 1С.</p></header>
      <div className={styles.contactLayout}>
        <section className={styles.contactDetails} aria-labelledby="expert-checklist-title">
          <p className={styles.eyebrow}>Что подготовить</p><h2 id="expert-checklist-title">Данные для проверки</h2>
          <ol className={styles.numberedList}>
            <li><strong>VIN</strong><span>17 символов из документов автомобиля.</span></li>
            <li><strong>Автомобиль</strong><span>Марка, модель, год, двигатель и привод.</span></li>
            <li><strong>Деталь</strong><span>Название, артикул или описание неисправности.</span></li>
          </ol>
          <p>Не отправляйте фото паспорта или банковские данные. Для подбора они не нужны.</p>
        </section>
        <ContactRequestForm enabled={dataCollectionEnabled} source="expert_help" title="Запросить подбор" description="Укажите VIN и сведения об автомобиле в сообщении. Ответ придёт по выбранному контакту." messagePlaceholder="VIN, марка, модель, год, двигатель, нужная деталь или известный артикул" />
      </div>
    </div>
  );
}
