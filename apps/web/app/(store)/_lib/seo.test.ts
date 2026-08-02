import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { breadcrumbJsonLd, organizationJsonLd, pageMetadata, privatePageMetadata, productJsonLd } from "./seo";

const originalBaseUrl = process.env.APP_BASE_URL;
const originalEnvironment = process.env.DEPLOYMENT_ENVIRONMENT;

beforeEach(() => {
  process.env.APP_BASE_URL = "https://an30.ru";
  process.env.DEPLOYMENT_ENVIRONMENT = "production";
});

afterEach(() => {
  process.env.APP_BASE_URL = originalBaseUrl;
  process.env.DEPLOYMENT_ENVIRONMENT = originalEnvironment;
});

describe("pageMetadata", () => {
  it("emits a canonical link and matching Open Graph URL", () => {
    const metadata = pageMetadata({ description: "Опис", path: "/catalog", title: "Каталог" });

    expect(metadata.alternates?.canonical).toBe("https://an30.ru/catalog");
    expect(metadata.openGraph?.url).toBe("https://an30.ru/catalog");
    expect(metadata.robots).toEqual({ follow: true, index: true });
  });

  it("refuses indexing when the deployment is not production", () => {
    process.env.DEPLOYMENT_ENVIRONMENT = "staging";
    process.env.APP_BASE_URL = "https://staging.an30.ru";

    const metadata = pageMetadata({ description: "Опис", path: "/", title: "Главная" });

    expect(metadata.robots).toEqual({ follow: false, index: false });
    expect(metadata.alternates?.canonical).toBe("https://staging.an30.ru/");
  });
});

describe("privatePageMetadata", () => {
  it("always refuses indexing", () => {
    expect(privatePageMetadata("Кабинет", "Опис").robots).toEqual({ follow: false, index: false });
  });
});

describe("productJsonLd", () => {
  const base = {
    availableQuantity: 3,
    brandName: "Bosch",
    description: "Описание",
    name: "Фильтр",
    priceKopeks: 125_050,
    sku: "F-1",
    slug: "filtr",
  };

  it("publishes an offer in roubles with the stock state", () => {
    const value = JSON.parse(productJsonLd(base));

    expect(value["@type"]).toBe("Product");
    expect(value.offers.price).toBe("1250.50");
    expect(value.offers.priceCurrency).toBe("RUB");
    expect(value.offers.availability).toBe("https://schema.org/InStock");
    expect(value.url).toBe("https://an30.ru/catalog/product/filtr");
  });

  it("marks a product without stock as out of stock", () => {
    const value = JSON.parse(productJsonLd({ ...base, availableQuantity: 0 }));
    expect(value.offers.availability).toBe("https://schema.org/OutOfStock");
  });

  it("omits the offer entirely when no price exists", () => {
    const value = JSON.parse(productJsonLd({ ...base, priceKopeks: null }));
    expect(value.offers).toBeUndefined();
    expect(value.name).toBe("Фильтр");
  });

  it("escapes angle brackets so the payload cannot close the script tag", () => {
    const serialised = productJsonLd({ ...base, name: "</script><img src=x>" });

    expect(serialised).not.toContain("</script>");
    expect(JSON.parse(serialised).name).toBe("</script><img src=x>");
  });
});

describe("breadcrumbJsonLd", () => {
  it("numbers the trail from one and resolves absolute items", () => {
    const value = JSON.parse(breadcrumbJsonLd([
      { name: "Главная", path: "/" },
      { name: "Каталог", path: "/catalog" },
    ]));

    expect(value.itemListElement).toHaveLength(2);
    expect(value.itemListElement[0].position).toBe(1);
    expect(value.itemListElement[1].item).toBe("https://an30.ru/catalog");
  });
});

describe("organizationJsonLd", () => {
  it("describes the store with a postal address", () => {
    const value = JSON.parse(organizationJsonLd());

    expect(value["@type"]).toBe("AutoPartsStore");
    expect(value.address.addressLocality).toBe("Чернышевск");
    expect(value.telephone).toBe("+79244742605");
  });
});
