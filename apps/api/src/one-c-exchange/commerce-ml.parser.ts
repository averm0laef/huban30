// Hand-rolled CommerceML 2 ("Обмен с сайтом") reader. Converts import.xml
// (Классификатор + Каталог/Товары) and offers.xml (ПакетПредложений) into the
// same internal row shape the AN30-007 staging pipeline already consumes
// (OneCCatalogRow — see packages/contracts/src/index.ts and
// apps/api/src/catalog/catalog-import.service.ts). No XML dependency: this
// walks the tree built by commerce-ml-xml.ts, exactly the approach
// apps/api/src/adapters/rossko/rossko-soap.ts uses for Rossko's SOAP XML.
//
// A row's `version` is always emitted as a 1 placeholder here — CommerceML
// carries no version concept at all, so the real value (does this row change
// anything, and what should its version be to make an unchanged resync a
// true no-op?) is resolved against the current database state by
// one-c-exchange-run.service.ts, not by this module.

import { normalizeSearchQuery } from "../catalog/catalog-search-normalize.js";
import { findChild, findChildren, localName, parseXmlDocument, XmlParseError, type XmlNode } from "./commerce-ml-xml.js";
import { buildBrandExternalId, buildSlug } from "./one-c-exchange-slug.js";

import type { OneCCatalogRow } from "@an30/contracts";

export class CommerceMlParseError extends Error {}

export interface CommerceMlRootInfo {
  /** CommerceML СодержитТолькоИзменения. Missing or unparseable => true (delta): see docs/ONE_C_INTEGRATION.md. */
  containsOnlyChanges: boolean;
  /** Always a valid ISO-8601 instant with an explicit offset, regardless of what (or whether) 1C sent one. */
  exportedAt: string;
}

export interface CatalogParseResult extends CommerceMlRootInfo {
  /** Product rows, in document order. */
  bodyRows: OneCCatalogRow[];
  /** Brand + category rows, always applied before bodyRows can reference them. */
  headerRows: OneCCatalogRow[];
  /** Every product externalId seen in this file — used to compute deactivations for a full snapshot. */
  productExternalIds: string[];
}

export interface OffersParseResult extends CommerceMlRootInfo {
  /** Price + stock rows, interleaved per offer, in document order. */
  bodyRows: OneCCatalogRow[];
  /** Always exactly the one synthetic warehouse row this exchange uses (see WAREHOUSE_ROW). */
  headerRows: OneCCatalogRow[];
}

const ROOT_TAG = "КоммерческаяИнформация";
const MAX_CATEGORY_DEPTH = 64;
const MAX_ATTRIBUTES_PER_PRODUCT = 200;

// The offers side of CommerceML this endpoint supports (see docs) carries a
// flat <Количество> with no per-warehouse breakdown, so every offer resolves
// to this one synthetic warehouse rather than one 1C sends explicitly. Its
// content never changes, so once applied it is always a no-op to re-upload —
// see one-c-exchange-run.service.ts's version resolution.
export const EXCHANGE_WAREHOUSE_EXTERNAL_ID = "1c-default-warehouse";
const WAREHOUSE_ROW: OneCCatalogRow = {
  code: "1C",
  entityType: "warehouse",
  externalId: EXCHANGE_WAREHOUSE_EXTERNAL_ID,
  isActive: true,
  name: "Основной склад (1С)",
  version: 1,
};

function parseDocument(xml: string): XmlNode {
  try {
    return parseXmlDocument(xml);
  } catch (error) {
    throw new CommerceMlParseError(
      error instanceof XmlParseError ? error.message : "Не удалось разобрать XML-документ",
    );
  }
}

function requireRoot(document: XmlNode): XmlNode {
  if (localName(document.tag) !== ROOT_TAG) {
    throw new CommerceMlParseError(`Ожидался корневой элемент <${ROOT_TAG}>`);
  }
  return document;
}

function parseExportedAt(raw: string | undefined): string {
  if (raw) {
    const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/u.test(raw.trim());
    const candidate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u.test(raw.trim()) && !hasOffset
      ? `${raw.trim()}Z`
      : raw.trim();
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function readRootInfo(root: XmlNode): CommerceMlRootInfo {
  const flag = root.attributes["СодержитТолькоИзменения"];
  // The highest-consequence decision in this file: guessing "full snapshot"
  // on an ambiguous or missing flag is how a partial upload can deactivate a
  // live catalog, so anything other than an explicit "false" is a delta.
  const containsOnlyChanges = flag === undefined ? true : flag.trim().toLowerCase() !== "false";
  return {
    containsOnlyChanges,
    exportedAt: parseExportedAt(root.attributes["ДатаФормирования"]),
  };
}

function textOf(node: XmlNode | undefined): string | undefined {
  const value = node?.text.trim();
  return value && value.length > 0 ? value : undefined;
}

function collectCategories(
  groupsNode: XmlNode,
  parentExternalId: string | null,
  depth: number,
  sink: OneCCatalogRow[],
): void {
  // A pathologically deep or cyclical-looking group tree stops rather than
  // recursing forever; CatalogImportService also independently rejects a
  // real cycle at validation time.
  if (depth > MAX_CATEGORY_DEPTH) return;
  let sortOrder = 0;
  for (const group of findChildren(groupsNode, "Группа")) {
    const id = textOf(findChild(group, "Ид"));
    const name = textOf(findChild(group, "Наименование"));
    sortOrder += 1;
    if (!id || !name) continue; // malformed single group entry: skip it, not the whole file
    sink.push({
      description: null,
      entityType: "category",
      externalId: id,
      isActive: true,
      name,
      parentExternalId,
      slug: buildSlug(name, id),
      sortOrder,
      version: 1,
    });
    const nested = findChild(group, "Группы");
    if (nested) collectCategories(nested, id, depth + 1, sink);
  }
}

function parseManufacturer(productNode: XmlNode): string | null {
  const node = findChild(productNode, "Изготовитель");
  if (!node) return null;
  return textOf(node) ?? textOf(findChild(node, "Наименование")) ?? null;
}

function parseProductAttributes(productNode: XmlNode): Record<string, unknown> {
  const container = findChild(productNode, "ЗначенияСвойств");
  if (!container) return {};
  const attributes: Record<string, unknown> = {};
  for (const entry of findChildren(container, "ЗначениеСвойства")) {
    if (Object.keys(attributes).length >= MAX_ATTRIBUTES_PER_PRODUCT) break;
    const id = textOf(findChild(entry, "Ид"));
    const value = findChild(entry, "Значение")?.text.trim();
    if (!id || value === undefined) continue;
    attributes[id] = value;
  }
  return attributes;
}

interface ParsedProduct {
  brandName: string | null;
  row: Extract<OneCCatalogRow, { entityType: "product" }>;
}

function parseProduct(productNode: XmlNode): ParsedProduct | null {
  const id = textOf(findChild(productNode, "Ид"));
  const name = textOf(findChild(productNode, "Наименование"));
  const sku = textOf(findChild(productNode, "Артикул"));
  if (!id || !name || !sku) return null; // a product missing a required field is dropped, not fatal to the file
  const groupsNode = findChild(productNode, "Группы");
  // CommerceML allows multiple <Ид> under <Группы> (multiple categories);
  // the internal schema keeps a single category per product, so the first
  // one wins — see docs/ONE_C_INTEGRATION.md.
  const categoryExternalId = groupsNode ? textOf(findChild(groupsNode, "Ид")) ?? null : null;
  const manufacturer = parseManufacturer(productNode);
  return {
    brandName: manufacturer,
    row: {
      attributes: parseProductAttributes(productNode),
      brandExternalId: manufacturer ? buildBrandExternalId(manufacturer) : null,
      categoryExternalId,
      description: null,
      entityType: "product",
      externalId: id,
      isActive: true,
      name,
      searchText: `${sku} ${name}`,
      sku,
      slug: buildSlug(name, id),
      version: 1,
    },
  };
}

/**
 * Converts a 1250.50-style CommerceML price into integer kopeks using pure
 * string/integer arithmetic, never floating point, so nothing is silently
 * rounded. Copies the rule from parsePriceToKopeks in
 * apps/api/src/adapters/rossko/rossko-soap.ts: anything that is not a clean
 * amount is rejected by returning null, and the caller drops the price row
 * entirely rather than guessing.
 */
const PRICE_PATTERN = /^\d{1,12}(?:\.\d{1,2})?$/u;
export function parseMoneyToKopeks(raw: string): number | null {
  const trimmed = raw.trim();
  if (!PRICE_PATTERN.test(trimmed)) return null;
  const [wholePart, fractionPart = ""] = trimmed.split(".");
  const kopeks = Number.parseInt(`${wholePart}${fractionPart.padEnd(2, "0")}`, 10);
  return Number.isSafeInteger(kopeks) && kopeks > 0 ? kopeks : null;
}

const QUANTITY_PATTERN = /^\d{1,12}$/u;
function parseQuantity(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (!QUANTITY_PATTERN.test(trimmed)) return null;
  const value = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647 ? value : null;
}

function parseOffer(offerNode: XmlNode): {
  price: Extract<OneCCatalogRow, { entityType: "price" }> | null;
  stock: Extract<OneCCatalogRow, { entityType: "stock" }> | null;
} {
  const productExternalId = textOf(findChild(offerNode, "Ид"));
  if (!productExternalId) return { price: null, stock: null };

  const pricesNode = findChild(offerNode, "Цены");
  // 1C can list several price types (retail, wholesale, ...); this shop
  // uses a single retail price, so the first <Цена> entry wins.
  const firstPrice = pricesNode ? findChildren(pricesNode, "Цена")[0] : undefined;
  const rawPrice = firstPrice ? findChild(firstPrice, "ЦенаЗаЕдиницу")?.text : undefined;
  const kopeks = rawPrice !== undefined ? parseMoneyToKopeks(rawPrice) : null;
  const price = kopeks !== null
    ? { amountKopeks: kopeks, currency: "RUB" as const, entityType: "price" as const, productExternalId, version: 1 }
    : null;

  const quantity = parseQuantity(findChild(offerNode, "Количество")?.text);
  const stock = quantity !== null
    ? {
        entityType: "stock" as const,
        productExternalId,
        quantityOnHand: quantity,
        version: 1,
        warehouseExternalId: EXCHANGE_WAREHOUSE_EXTERNAL_ID,
      }
    : null;

  return { price, stock };
}

/** Parses import.xml: Классификатор/Группы (recursive category tree) + Каталог/Товары/Товар. */
export function parseImportXml(xml: string): CatalogParseResult {
  const root = requireRoot(parseDocument(xml));
  const info = readRootInfo(root);
  const headerRows: OneCCatalogRow[] = [];
  const bodyRows: OneCCatalogRow[] = [];
  const productExternalIds: string[] = [];

  const classifierNode = findChild(root, "Классификатор");
  const classifierGroups = classifierNode ? findChild(classifierNode, "Группы") : undefined;
  if (classifierGroups) collectCategories(classifierGroups, null, 0, headerRows);

  const catalogNode = findChild(root, "Каталог");
  const productsNode = catalogNode ? findChild(catalogNode, "Товары") : undefined;
  const brandNames = new Map<string, string>();
  if (productsNode) {
    for (const productNode of findChildren(productsNode, "Товар")) {
      const parsed = parseProduct(productNode);
      if (!parsed) continue;
      bodyRows.push(parsed.row);
      productExternalIds.push(parsed.row.externalId);
      if (parsed.brandName) {
        const brandExternalId = buildBrandExternalId(parsed.brandName);
        if (!brandNames.has(brandExternalId)) {
          brandNames.set(brandExternalId, normalizeSearchQuery(parsed.brandName));
        }
      }
    }
  }
  for (const [externalId, name] of brandNames) {
    headerRows.push({
      entityType: "brand", externalId, isActive: true, name, slug: buildSlug(name, externalId), version: 1,
    });
  }

  return { ...info, bodyRows, headerRows, productExternalIds };
}

/** Parses offers.xml: ПакетПредложений/Предложения/Предложение -> price + stock rows against one synthetic warehouse. */
export function parseOffersXml(xml: string): OffersParseResult {
  const root = requireRoot(parseDocument(xml));
  const info = readRootInfo(root);
  const bodyRows: OneCCatalogRow[] = [];

  const packageNode = findChild(root, "ПакетПредложений");
  const offersNode = packageNode ? findChild(packageNode, "Предложения") : undefined;
  if (offersNode) {
    for (const offerNode of findChildren(offersNode, "Предложение")) {
      const { price, stock } = parseOffer(offerNode);
      if (price) bodyRows.push(price);
      if (stock) bodyRows.push(stock);
    }
  }

  return { ...info, bodyRows, headerRows: [WAREHOUSE_ROW] };
}
