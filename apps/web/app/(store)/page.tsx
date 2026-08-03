import type { Metadata } from "next";

import { CatalogTeaser, CategoryGrid, ChooseHelpBlock, FeaturePanel, HomePromo } from "./_components/home-sections";
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
      <h1 className={styles.visuallyHidden}>Автозапчасти в Чернышевске — АН-30</h1>
      <HomePromo />
      <CategoryGrid />
      <FeaturePanel />
      <CatalogTeaser />
      <ChooseHelpBlock />
    </div>
  );
}
