import type { Metadata } from "next";

import { HomeShowcase } from "./_components/home-sections";
import { JsonLd } from "./_components/json-ld";
import { organizationJsonLd, pageMetadata } from "./_lib/seo";

export const metadata: Metadata = pageMetadata({
  description: "Автозапчасти в Чернышевске: подбор по названию и артикулу, актуальные цены и наличие, проверка совместимости сотрудником магазина.",
  path: "/",
  title: "Автозапчасти в Чернышевске",
});

export default function StorefrontPage() {
  return (
    <>
      <JsonLd value={organizationJsonLd()} />
      <HomeShowcase />
    </>
  );
}
