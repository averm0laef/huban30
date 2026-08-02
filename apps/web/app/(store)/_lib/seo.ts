import type { Metadata } from "next";

import {
  SITE_LEGAL_NAME,
  SITE_NAME,
  STORE_COUNTRY,
  STORE_LOCALITY,
  STORE_PHONE,
  STORE_REGION,
  STORE_STREET,
  absoluteUrl,
  indexingAllowed,
} from "../../site-config";

interface PageSeo {
  /** Absolute path of the canonical URL, for example `/catalog`. */
  path: string;
  description: string;
  title: string;
}

/**
 * Builds the metadata shared by every indexable storefront page.
 *
 * Canonical links always point at the configured origin, so a staging host
 * cannot claim production URLs, and crawling is refused outside production.
 */
export function pageMetadata({ description, path, title }: PageSeo): Metadata {
  const url = absoluteUrl(path);
  return {
    alternates: { canonical: url },
    description,
    openGraph: {
      description,
      locale: "ru_RU",
      siteName: SITE_LEGAL_NAME,
      title,
      type: "website",
      url,
    },
    robots: indexingAllowed()
      ? { follow: true, index: true }
      : { follow: false, index: false },
    title,
    twitter: { card: "summary", description, title },
  };
}

/** Metadata for a page that must never be indexed, such as the account area. */
export function privatePageMetadata(title: string, description: string): Metadata {
  return { description, robots: { follow: false, index: false }, title };
}

function jsonLd(value: Record<string, unknown>): string {
  // Angle brackets are escaped so the payload cannot terminate the script tag.
  return JSON.stringify(value).replace(/</gu, "\\u003c");
}

const postalAddress = {
  "@type": "PostalAddress",
  addressCountry: STORE_COUNTRY,
  addressLocality: STORE_LOCALITY,
  addressRegion: STORE_REGION,
  streetAddress: STORE_STREET,
};

/** Store identity, attached once on the storefront layout. */
export function organizationJsonLd(): string {
  return jsonLd({
    "@context": "https://schema.org",
    "@type": "AutoPartsStore",
    address: postalAddress,
    areaServed: STORE_REGION,
    legalName: SITE_LEGAL_NAME,
    name: SITE_NAME,
    telephone: STORE_PHONE,
    url: absoluteUrl("/"),
  });
}

interface ProductSeo {
  availableQuantity: number;
  brandName: string | null;
  description: string | null;
  name: string;
  priceKopeks: number | null;
  sku: string;
  slug: string;
}

/**
 * Product markup.
 *
 * An offer is published only when a real price exists, because Schema.org
 * treats `price` as required and an invented value would misrepresent stock.
 */
export function productJsonLd(product: ProductSeo): string {
  const url = absoluteUrl(`/catalog/product/${product.slug}`);
  const value: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    sku: product.sku,
    url,
  };
  if (product.brandName) value.brand = { "@type": "Brand", name: product.brandName };
  if (product.description) value.description = product.description;
  if (product.priceKopeks !== null) {
    value.offers = {
      "@type": "Offer",
      availability: product.availableQuantity > 0
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      price: (product.priceKopeks / 100).toFixed(2),
      priceCurrency: "RUB",
      seller: { "@type": "Organization", name: SITE_NAME },
      url,
    };
  }
  return jsonLd(value);
}

/** Breadcrumb trail matching the visible navigation. */
export function breadcrumbJsonLd(trail: Array<{ name: string; path: string }>): string {
  return jsonLd({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((entry, index) => ({
      "@type": "ListItem",
      item: absoluteUrl(entry.path),
      name: entry.name,
      position: index + 1,
    })),
  });
}
