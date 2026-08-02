import type { Metadata } from "next";

import { CatalogTeaser, HomeHero, HowItWorks, InfoStrip } from "./_components/home-sections";
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
      <HomeHero />
      <InfoStrip />
      <CatalogTeaser />
      <HowItWorks />
    </div>
  );
}
