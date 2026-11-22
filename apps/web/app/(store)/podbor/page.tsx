import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { pageMetadata } from "../_lib/seo";
import { PartsFinder } from "./parts-finder";
import styles from "./parts-finder.module.css";

export const metadata: Metadata = pageMetadata({
  description: "Подбор автозапчастей по марке, модели и двигателю или по VIN: артикулы, аналоги, цены и наличие в магазине АН-30.",
  path: "/podbor",
  title: "Подбор запчастей по автомобилю",
});

export default function PartsFinderPage() {
  return (
    <div className={styles.page}>
      <nav aria-label="Хлебные крошки" className={styles.breadcrumbs}>
        <Link href="/">Главная</Link><span aria-hidden="true">›</span><span aria-current="page">Подбор по автомобилю</span>
      </nav>
      <Suspense fallback={<div className={styles.panel} aria-busy="true" />}>
        <PartsFinder />
      </Suspense>
    </div>
  );
}
