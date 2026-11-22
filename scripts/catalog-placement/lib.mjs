// Shared by the scripts of this folder: where the 1С list export lives and how one item is placed.
// The export itself is the owner's data and stays outside Git, in local-data/1c/ (see README.md).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { STOREFRONT_TAXONOMY } from "../../packages/contracts/dist/index.js";
import { decideStorefrontCategory } from "../../apps/api/dist/catalog/catalog-known-categories.js";

export const DATA_DIR = fileURLToPath(new URL("../../local-data/1c/", import.meta.url));
export const QUEUE = "bez-kategorii";

/** Slug → «Раздел → Подраздел», for people. */
export const LABELS = new Map(STOREFRONT_TAXONOMY.flatMap((section) => [
  [section.slug, section.label],
  ...section.children.map((child) => [child.slug, `${section.label} → ${child.label}`]),
]));
/** Slug → label, top-level sections only. */
export const SECTION_LABELS = new Map(STOREFRONT_TAXONOMY.map((section) => [section.slug, section.label]));

/** The export to read: AN30_1C_EXPORT_JSON, else the newest nomenklatura-*.json in local-data/1c/. */
export function exportFile() {
  if (process.env.AN30_1C_EXPORT_JSON) return process.env.AN30_1C_EXPORT_JSON;
  const newest = existsSync(DATA_DIR) ? readdirSync(DATA_DIR).filter((name) => /^nomenklatura-.*\.json$/u.test(name)).sort().at(-1) : undefined;
  if (!newest) {
    console.error("No export found. Save the 1С list export into local-data/1c/ and convert it: see scripts/catalog-placement/README.md.");
    process.exit(1);
  }
  return `${DATA_DIR}${newest}`;
}

/** Items of the export: { name, sku, code, stock, unit, price, note }. */
export function loadItems() {
  return JSON.parse(readFileSync(exportFile(), "utf8"));
}

/** Where the shop's rules put the item when only its name and article are known (the list export has no groups). */
export function place(item) {
  return decideStorefrontCategory({ groupNames: [], productName: item.name, sku: item.sku });
}

export const oneLine = (text) => text.replace(/\s+/gu, " ").trim();
