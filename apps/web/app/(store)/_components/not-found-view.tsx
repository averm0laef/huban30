import Image from "next/image";
import Link from "next/link";

import { STORE_PHONE, STORE_PHONE_DISPLAY } from "../../site-config";
import { BrandWheel } from "./brand-mark";
import styles from "./not-found.module.css";
import storeStyles from "./storefront.module.css";

/** Design board «Страница 404». Six sections people open most often. */
const POPULAR_SECTIONS = [
  { label: "Моторные масла", slug: "motornye-masla" },
  { label: "Фильтры", slug: "filtry" },
  { label: "Тормозная система", slug: "tormoznaya-sistema" },
  { label: "Аккумуляторы", slug: "akkumulyatory" },
  { label: "Автолампы", slug: "avtolampy" },
  { label: "Антифриз", slug: "antifriz" },
] as const;

export function NotFoundView() {
  return (
    <div className={storeStyles.page}>
      <section aria-labelledby="not-found-title" className={styles.card}>
        <span className={styles.eyebrow}>Ошибка 404</span>
        <p aria-hidden="true" className={styles.code}>
          <span>4</span>
          <BrandWheel className={styles.wheel} />
          <span>4</span>
        </p>
        <div className={styles.intro}>
          <h1 id="not-found-title">Такой страницы нет</h1>
          <p>Ссылка могла устареть, или в адресе опечатка. Найдите деталь поиском или откройте нужный раздел.</p>
        </div>
        <form action="/catalog" className={styles.search} method="get" role="search">
          <label className={styles.visuallyHidden} htmlFor="not-found-search">Поиск по каталогу</label>
          <input autoComplete="off" enterKeyHint="search" id="not-found-search" name="q" placeholder="Артикул, название или VIN" type="search" />
          <button type="submit">Найти</button>
        </form>
        <nav aria-labelledby="not-found-sections" className={styles.sections}>
          <h2 id="not-found-sections">Популярные разделы</h2>
          <ul>
            {POPULAR_SECTIONS.map((section) => (
              <li key={section.slug}>
                <Link href={`/catalog/${section.slug}`}>
                  <Image alt="" height={64} src={`/categories/${section.slug}.webp`} width={64} />
                  <span>{section.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className={styles.actions}>
          <Link className={styles.primary} href="/catalog">Открыть каталог</Link>
          <Link className={styles.secondary} href="/podbor">Подбор по авто</Link>
        </div>
        <p className={styles.help}>
          Не нашли нужное? Позвоните <a href={`tel:${STORE_PHONE}`}>{STORE_PHONE_DISPLAY}</a> или <Link href="/chat">напишите в чат</Link>.
        </p>
      </section>
    </div>
  );
}
