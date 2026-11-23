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
// one-c-exchange.service.ts, not by this module.

import { normalizeSearchQuery } from "../catalog/catalog-search-normalize.js";
import { productSearchText } from "../catalog/catalog-search-reading.js";
import { findChild, findChildren, localName, parseXmlDocument, XmlParseError, type XmlNode } from "./commerce-ml-xml.js";
import { buildBrandExternalId, buildSlug, shortId } from "./one-c-exchange-slug.js";

import { publicProductName, type OneCCatalogRow } from "@an30/contracts";
import { partMakerInName } from "../catalog/catalog-part-makers.js";

export class CommerceMlParseError extends Error {}

export interface CommerceMlRootInfo {
  /** CommerceML СодержитТолькоИзменения. Missing or unparseable => true (delta): see docs/ONE_C_INTEGRATION.md. */
  containsOnlyChanges: boolean;
  /** Always a valid ISO-8601 instant with an explicit offset, regardless of what (or whether) 1C sent one. */
  exportedAt: string;
}

/**
 * One 1C property (Классификатор/Свойства/Свойство): its human name and, for
 * a reference-typed property (ТипЗначений=Справочник), the value-id -> text
 * map. A goods file only carries <Ид>/<Значение> pairs, so without this map a
 * brand given as a property, or a car make chosen from a list, is a GUID.
 */
export interface CommerceMlProperty {
  name: string;
  values: Record<string, string>;
}
export type CommerceMlPropertyDictionary = Record<string, CommerceMlProperty>;

/**
 * A product row as staged for the exchange: the contract row plus the
 * relative paths of its <Картинка> files, which 1C uploads with mode=file in
 * the same session. Extra JSON keys survive the jsonb run staging untouched.
 */
export type ExchangeProductRow = Extract<OneCCatalogRow, { entityType: "product" }> & { imagePaths?: string[] };

/**
 * A warehouse row referenced by an offer whose <Склады> entry (and so its
 * name) was not part of this file: create it under a placeholder name, but
 * never rename an existing warehouse to that placeholder.
 */
export type ExchangeWarehouseRow = Extract<OneCCatalogRow, { entityType: "warehouse" }> & { keepExistingName?: boolean };

export interface CatalogParseResult extends CommerceMlRootInfo {
  /** Product rows, in document order. */
  bodyRows: OneCCatalogRow[];
  /** Brand + category (+ classifier warehouse) rows, always applied before bodyRows can reference them. */
  headerRows: OneCCatalogRow[];
  /** Every product externalId seen in this file — used to compute deactivations for a full snapshot. */
  productExternalIds: string[];
  /** Property definitions known after this file: the caller's stored ones overlaid with this file's own <Свойства>. */
  properties: CommerceMlPropertyDictionary;
}

export interface OffersParseResult extends CommerceMlRootInfo {
  /** Price + stock rows, interleaved per offer, in document order. */
  bodyRows: OneCCatalogRow[];
  /** The synthetic warehouse row plus one row per real 1C warehouse an offer references. */
  headerRows: OneCCatalogRow[];
  /** True when at least one offer carried a stock figure: only such a full file may zero omitted stock. */
  carriesStock: boolean;
  /** The 1С price type the prices were taken from, as 1С names it; null when the file names none or only cost types. */
  priceTypeName: string | null;
}

const ROOT_TAG = "КоммерческаяИнформация";
const MAX_CATEGORY_DEPTH = 64;
const MAX_ATTRIBUTES_PER_PRODUCT = 200;

// An offer that only carries a flat <Количество> (no per-warehouse
// breakdown) resolves to this one synthetic warehouse. Offers that name their
// warehouses (<Склад ИдСклада> or <Остатки><Остаток><Склад>) keep the real
// per-warehouse split instead; see parseOffersXml.
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

function readRootInfo(root: XmlNode, dataNode: XmlNode | undefined): CommerceMlRootInfo {
  // CommerceML puts this flag on the data container itself -- <Каталог> in
  // import.xml and <ПакетПредложений> in offers.xml. Some older/custom 1C
  // exporters put it on the document root, so keep that as a compatibility
  // fallback, but never let it override the standard, more specific value.
  const flag = dataNode?.attributes["СодержитТолькоИзменения"]
    ?? root.attributes["СодержитТолькоИзменения"];
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

function isDeletionMarked(node: XmlNode): boolean {
  const value = textOf(findChild(node, "ПометкаУдаления"))?.toLowerCase();
  // CommerceML 2.08+ may instead say Статус="Удален" (attribute or element).
  const status = (node.attributes["Статус"] ?? textOf(findChild(node, "Статус")))?.trim().toLowerCase();
  return value === "true" || value === "1" || status === "удален" || status === "удалён";
}

/** Lower-cased, ё-folded, whitespace-collapsed: how property names are matched. */
function foldName(value: string): string {
  return normalizeSearchQuery(value).toLowerCase().replace(/ё/gu, "е");
}

// Property names (folded) that carry the manufacturer when 1C does not fill
// <Изготовитель>. "Марка" alone is deliberately absent: in auto-parts
// databases it almost always means the car make, not the part's brand.
const BRAND_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "производитель", "бренд", "brand", "торговая марка", "изготовитель", "марка производителя",
  "производитель (бренд)", "бренд (производитель)", "бренд производителя",
]);
// Property names (folded) that describe which cars a part is for. Kept in the
// private attributes under their 1C name and added to searchText for recall;
// they are not published as verified fitment (docs/CATALOG_DATA_STRATEGY.md).
const VEHICLE_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "марка", "марка автомобиля", "марка авто", "марка тс", "модель", "модель автомобиля", "модель авто",
  "применяемость", "применимость", "автомобиль", "автомобили", "совместимость", "подходит для",
]);
const MAX_IMAGES_PER_PRODUCT = 10;
const SAFE_IMAGE_PATH = /^[A-Za-z0-9._/-]{1,400}$/u;

/** Reads Классификатор/Свойства (CommerceML 2.04+ <Свойство>, 2.03 <СвойствоНоменклатуры>). */
function collectProperties(classifierNode: XmlNode | undefined, sink: CommerceMlPropertyDictionary): void {
  const container = classifierNode ? findChild(classifierNode, "Свойства") : undefined;
  if (!container) return;
  for (const node of [...findChildren(container, "Свойство"), ...findChildren(container, "СвойствоНоменклатуры")]) {
    const id = textOf(findChild(node, "Ид"));
    const name = textOf(findChild(node, "Наименование"));
    if (!id || !name) continue;
    const values: Record<string, string> = {};
    const variants = findChild(node, "ВариантыЗначений");
    for (const variant of variants ? variants.children : []) {
      const valueId = textOf(findChild(variant, "ИдЗначения")) ?? textOf(findChild(variant, "Ид"));
      const value = textOf(findChild(variant, "Значение"));
      if (valueId && value) values[valueId] = value;
    }
    sink[id] = { name, values };
  }
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
      isActive: !isDeletionMarked(group),
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

interface ParsedProperties {
  attributes: Record<string, unknown>;
  brandName: string | null;
  vehicleText: string[];
}

/**
 * Resolves <ЗначенияСвойств> against the property dictionary: attributes are
 * keyed by the property's 1C name (its Ид only when the definition is
 * unknown) and reference values are turned into their text. An unresolvable
 * reference value is a GUID, so it is never used as a brand name.
 */
function parseProductProperties(productNode: XmlNode, properties: CommerceMlPropertyDictionary): ParsedProperties {
  const result: ParsedProperties = { attributes: {}, brandName: null, vehicleText: [] };
  const container = findChild(productNode, "ЗначенияСвойств");
  if (!container) return result;
  for (const entry of findChildren(container, "ЗначениеСвойства")) {
    if (Object.keys(result.attributes).length >= MAX_ATTRIBUTES_PER_PRODUCT) break;
    const id = textOf(findChild(entry, "Ид"));
    if (!id) continue;
    const definition = properties[id];
    const resolved: string[] = [];
    let unresolvedReference = false;
    for (const valueNode of findChildren(entry, "Значение")) {
      const raw = valueNode.text.trim();
      if (!raw) continue;
      const text = definition?.values[raw];
      if (text !== undefined) resolved.push(text);
      else {
        if (definition && Object.keys(definition.values).length > 0) unresolvedReference = true;
        resolved.push(raw);
      }
    }
    if (resolved.length === 0) continue;
    const key = (definition?.name ?? id).slice(0, 120);
    const value = resolved.join(", ").slice(0, 2_000);
    result.attributes[key] = value;
    if (!definition) continue;
    const folded = foldName(definition.name);
    if (BRAND_PROPERTY_NAMES.has(folded) && !unresolvedReference && resolved.length === 1 && !result.brandName) {
      result.brandName = value;
    }
    if (VEHICLE_PROPERTY_NAMES.has(folded) && !unresolvedReference) result.vehicleText.push(value);
  }
  return result;
}

function parseImagePaths(productNode: XmlNode): string[] {
  const paths: string[] = [];
  for (const node of findChildren(productNode, "Картинка")) {
    const value = textOf(node)?.replace(/\\/gu, "/");
    if (!value || !SAFE_IMAGE_PATH.test(value) || value.includes("..") || paths.includes(value)) continue;
    paths.push(value);
    if (paths.length >= MAX_IMAGES_PER_PRODUCT) break;
  }
  return paths;
}

function parseProductRequisite(productNode: XmlNode, requisiteName: string): string | undefined {
  const container = findChild(productNode, "ЗначенияРеквизитов");
  if (!container) return undefined;
  for (const entry of findChildren(container, "ЗначениеРеквизита")) {
    if (textOf(findChild(entry, "Наименование"))?.toLowerCase() !== requisiteName.toLowerCase()) continue;
    return textOf(findChild(entry, "Значение"));
  }
  return undefined;
}

// TODO(article crosses, AN30-013 cross-reference index): CommerceML *can*
// carry analogue/cross article numbers as product properties, but this
// parser cannot identify them yet, and none of the properties captured
// above are usable for that today. What is missing, precisely:
//
//   1. Property *definitions* are now parsed (collectProperties) and values
//      resolved by name, but which property, if any, means "аналог",
//      "кросс-номер" or "OEM номер" is assigned per-database, not fixed by
//      the CommerceML spec, so nothing here can pick it automatically yet.
//   2. A cross-bearing property can be plain text (one delimited string of
//      several article numbers — the delimiter is 1C-instance-specific: a
//      comma, a semicolon, or newlines have all been seen in the wild) or a
//      reference to a *separate* value catalog (<ТипЗначений>Справочник...),
//      in which case the actual article numbers live in yet another part of
//      the export this parser does not read at all.
//   3. Even once found, a 1C-sourced cross has no supplier-style nested
//      structure to lean on (contrast rossko-soap.ts's `<crosses><Part>`
//      tree) — brand attribution for each linked article would have to come
//      from a *second* property on the same product, looked up the same way.
//
// None of this is implemented here on purpose, per AN30-013's instruction
// not to half-build a parser change concurrent work (this file) is already
// touching. If it is picked up later: parse <Свойства> into an id->name map
// next to collectCategories, let parseProduct optionally emit any resolved
// cross article strings it finds (split on the tenant's actual delimiter),
// and feed the result through the exact same ingestion path Rossko crosses
// already use — canonicalizeCrossPair/ingestArticleCrosses in
// apps/worker/src/article-cross-ingest.ts, with source: 'one_c' (already a
// valid app.article_crosses.source value — see migration 0018). Do not add
// a second normaliser or a second ingest path for it.

interface ParsedProduct {
  brandName: string | null;
  row: ExchangeProductRow;
}

function parseProduct(productNode: XmlNode, properties: CommerceMlPropertyDictionary, publishDescription: boolean): ParsedProduct | null {
  const id = textOf(findChild(productNode, "Ид"));
  // The staff's own notes typed into a name in 1С («(Ш)», «+++», the shelf box) are taken out here, where the
  // name enters the site: the order of a section, the search, the page address and the photo caption are all
  // derived from the stored name (packages/contracts/src/product-name.ts).
  const typedName = textOf(findChild(productNode, "Наименование"));
  const name = typedName ? publicProductName(typedName) : typedName;
  // Артикул is optional in real 1C exports. Bitrix-compatible CommerceML
  // commonly carries the stable nomenclature code either as a direct <Код>
  // or as the predefined "Код" requisite instead; dropping those products
  // would make a normal 1C catalog look mysteriously incomplete.
  const code = textOf(findChild(productNode, "Код")) ?? parseProductRequisite(productNode, "Код");
  const sku = textOf(findChild(productNode, "Артикул")) ?? code;
  if (!id || !name || !sku) return null; // a product missing a required field is dropped, not fatal to the file
  const groupsNode = findChild(productNode, "Группы");
  // CommerceML allows multiple <Ид> under <Группы> (multiple categories);
  // the internal schema keeps a single category per product, so the first
  // one wins — see docs/ONE_C_INTEGRATION.md.
  const categoryExternalId = groupsNode ? textOf(findChild(groupsNode, "Ид")) ?? null : null;
  const parsedProperties = parseProductProperties(productNode, properties);
  // Brand precedence: the standard <Изготовитель>, then a brand-like
  // property (Производитель/Бренд/Торговая марка), then a "Производитель"
  // requisite that some configurations use instead.
  // Last of all, the maker written in the name itself: the owner's base names no manufacturer anywhere else.
  const manufacturerRaw = parseManufacturer(productNode)
    ?? parsedProperties.brandName
    ?? parseProductRequisite(productNode, "Производитель")
    ?? (name ? partMakerInName(name) : null);
  const manufacturer = manufacturerRaw ? normalizeSearchQuery(manufacturerRaw).slice(0, 200) || null : null;
  const imagePaths = parseImagePaths(productNode);
  // The article, the name as typed, the cars it fits — and the words the name is read by when it is typed with
  // shorthand or a Latin look-alike letter («Cальник», «аром-р»), so the search finds it by the proper word.
  const searchText = productSearchText(sku, name, parsedProperties.vehicleText);
  return {
    brandName: manufacturer,
    row: {
      attributes: parsedProperties.attributes,
      brandExternalId: manufacturer ? buildBrandExternalId(manufacturer) : null,
      categoryExternalId,
      // Kept only when the base is set to publish it (OneCExchangeOptions.publishDescriptions).
      description: publishDescription ? textOf(findChild(productNode, "Описание")) ?? null : null,
      entityType: "product",
      externalId: id,
      isActive: !isDeletionMarked(productNode),
      name,
      searchText,
      sku,
      slug: buildSlug(name, id),
      version: 1,
      ...(code && code.length <= 128 ? { oneCCode: code } : {}),
      ...(imagePaths.length > 0 ? { imagePaths } : {}),
    },
  };
}

/**
 * Converts a CommerceML price into integer kopeks using string/integer
 * arithmetic, never floating point. Accepts what 1C actually exports in
 * different configurations: "1250.50", "1250,50", "1 250,50" (regular or
 * non-breaking space as thousands separator) and up to 4 decimals, rounded
 * half-up to kopeks. Anything else — or a zero price — returns null and the
 * caller keeps the previous price rather than guessing.
 */
const PRICE_PATTERN = /^\d{1,12}(?:\.\d{1,4})?$/u;
export function parseMoneyToKopeks(raw: string): number | null {
  const trimmed = raw.trim().replace(/[\s\u00a0\u202f]/gu, "").replace(",", ".");
  if (!PRICE_PATTERN.test(trimmed)) return null;
  const [wholePart = "", fractionPart = ""] = trimmed.split(".");
  const padded = fractionPart.padEnd(4, "0");
  let kopeks = Number.parseInt(`${wholePart}${padded.slice(0, 2)}`, 10);
  if (Number.parseInt(padded.slice(2), 10) >= 50) kopeks += 1;
  return Number.isSafeInteger(kopeks) && kopeks > 0 ? kopeks : null;
}

/**
 * Stock as 1C exports it: "5", "5.000", "2,5" (fractional units are rounded
 * down — the shop sells whole items) and negative balances (sold ahead of a
 * receipt) which mean nothing is available, i.e. 0.
 */
const QUANTITY_PATTERN = /^-?\d{1,12}(?:[.,]\d+)?$/u;
export function parseQuantity(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim().replace(/[\s\u00a0\u202f]/gu, "");
  if (!QUANTITY_PATTERN.test(trimmed)) return null;
  if (trimmed.startsWith("-")) return 0;
  const value = Number.parseInt(trimmed.split(/[.,]/u)[0] ?? "", 10);
  return Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647 ? value : null;
}

function isRubCurrency(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === "") return true;
  const normalized = raw.trim().toUpperCase().replace(/[.\s]+/gu, "");
  // RUB is the ISO 4217 code. RUR and the Russian spelling are retained for
  // older/custom 1C configurations that still emit them; every other
  // currency must be rejected rather than silently relabelled as roubles.
  return normalized === "RUB" || normalized === "RUR" || normalized === "РУБ" || normalized === "643";
}

/**
 * Which 1С price type a file's prices are taken from. One answer for the
 * whole file, so every product of an exchange carries the same kind of price.
 */
export type PriceTypeChoice =
  /** The file names no price types: each offer's own (first) price is taken. */
  | { kind: "any" }
  /** The file names only cost types («Учетная цена»): no price is published. */
  | { kind: "none" }
  | { id: string; kind: "type"; name: string };

/** Price types that are the shop's cost, not what it sells at; published only when staff name them explicitly. */
const COST_PRICE_TYPE_STEMS = ["учетн", "закуп", "себестоим"] as const;

function isCostPriceType(name: string): boolean {
  const folded = foldName(name);
  return COST_PRICE_TYPE_STEMS.some((stem) => folded.includes(stem));
}

/**
 * Picks the price type from ПакетПредложений/ТипыЦен: the one staff named for
 * the base (ONE_C_PRICE_TYPE) wins; otherwise, among the types that are not a
 * cost price, the retail one («розн…») and failing that the first listed.
 */
export function selectPriceType(packageNode: XmlNode | undefined, preferredName?: string): PriceTypeChoice {
  const typesNode = packageNode ? findChild(packageNode, "ТипыЦен") : undefined;
  const types = (typesNode ? findChildren(typesNode, "ТипЦены") : []).flatMap((node) => {
    const id = textOf(findChild(node, "Ид"));
    return id ? [{ id, name: textOf(findChild(node, "Наименование")) ?? "" }] : [];
  });
  if (types.length === 0) return { kind: "any" };
  const wanted = preferredName ? foldName(preferredName) : "";
  const named = wanted ? types.find((type) => foldName(type.name) === wanted) : undefined;
  const selling = types.filter((type) => !isCostPriceType(type.name));
  const chosen = named ?? selling.find((type) => foldName(type.name).includes("розн")) ?? selling[0];
  return chosen ? { ...chosen, kind: "type" } : { kind: "none" };
}

interface OfferStock {
  /** Quantity per real 1C warehouse id, when the offer names its warehouses. */
  byWarehouse: Map<string, number>;
  /** Flat quantity when the offer carries no named warehouse breakdown. */
  total: number | null;
}

/**
 * Reads an offer's stock. A named breakdown (<Склад ИдСклада КоличествоНаСкладе>
 * or <Остатки><Остаток><Склад><Ид/><Количество/>) wins over the flat
 * <Количество>, which usually just repeats its sum; without a breakdown the
 * flat figure (or unnamed <Остаток>) is the total.
 */
function parseOfferStock(offerNode: XmlNode): OfferStock {
  const byWarehouse = new Map<string, number>();
  const unnamed: number[] = [];
  const add = (warehouseId: string | undefined, quantity: number | null) => {
    if (quantity === null) return;
    if (warehouseId) byWarehouse.set(warehouseId, Math.min((byWarehouse.get(warehouseId) ?? 0) + quantity, 2_147_483_647));
    else unnamed.push(quantity);
  };
  for (const warehouse of findChildren(offerNode, "Склад")) {
    add(warehouse.attributes["ИдСклада"]?.trim() || textOf(findChild(warehouse, "Ид")),
      parseQuantity(warehouse.attributes["КоличествоНаСкладе"] ?? textOf(findChild(warehouse, "Количество"))));
  }
  const rests = findChild(offerNode, "Остатки");
  for (const rest of rests ? findChildren(rests, "Остаток") : []) {
    const warehouse = findChild(rest, "Склад");
    add(warehouse ? textOf(findChild(warehouse, "Ид")) : undefined,
      parseQuantity(findChild(warehouse ?? rest, "Количество")?.text));
  }
  if (byWarehouse.size > 0) return { byWarehouse, total: null };
  const flat = parseQuantity(findChild(offerNode, "Количество")?.text);
  const total = flat ?? (unnamed.length ? unnamed.reduce((sum, value) => sum + value, 0) : null);
  return { byWarehouse, total };
}

function parseOfferPrice(
  offerNode: XmlNode,
  productExternalId: string,
  choice: PriceTypeChoice,
): Extract<OneCCatalogRow, { entityType: "price" }> | null {
  if (choice.kind === "none") return null;
  const pricesNode = findChild(offerNode, "Цены");
  const prices = pricesNode ? findChildren(pricesNode, "Цена") : [];
  const typeOf = (price: XmlNode) => textOf(findChild(price, "ИдТипаЦены"));
  // A lone price without a type id belongs to the file's only type; a price of another type is never substituted.
  const chosenPrice = choice.kind === "any"
    ? prices[0]
    : prices.find((price) => typeOf(price) === choice.id) ?? (prices.length === 1 && !typeOf(prices[0]!) ? prices[0] : undefined);
  const rawPrice = chosenPrice ? findChild(chosenPrice, "ЦенаЗаЕдиницу")?.text : undefined;
  const rawCurrency = chosenPrice ? findChild(chosenPrice, "Валюта")?.text : undefined;
  const kopeks = rawPrice !== undefined ? parseMoneyToKopeks(rawPrice) : null;
  return kopeks !== null && isRubCurrency(rawCurrency)
    ? { amountKopeks: kopeks, currency: "RUB", entityType: "price", productExternalId, version: 1 }
    : null;
}

/** Warehouse id -> name from <Склады> of the package and/or its classifier. */
function collectWarehouseNames(...containers: Array<XmlNode | undefined>): Map<string, string> {
  const names = new Map<string, string>();
  for (const container of containers) {
    const warehouses = container ? findChild(container, "Склады") : undefined;
    for (const node of warehouses ? findChildren(warehouses, "Склад") : []) {
      const id = textOf(findChild(node, "Ид"));
      const name = textOf(findChild(node, "Наименование"));
      if (id && name) names.set(id, name);
    }
  }
  return names;
}

/** A real 1C warehouse row. The code only has to be unique and stable; the name is what staff see. */
export function buildExchangeWarehouseRow(externalId: string, name: string | undefined): ExchangeWarehouseRow {
  return {
    code: `1C-${shortId(externalId)}`,
    entityType: "warehouse",
    externalId,
    isActive: true,
    name: (name ?? `Склад 1С ${shortId(externalId).slice(0, 6)}`).slice(0, 200),
    version: 1,
    ...(name ? {} : { keepExistingName: true }),
  };
}

/** Parses import.xml: Классификатор/Группы (recursive category tree), Свойства, Склады + Каталог/Товары/Товар. */
export function parseImportXml(
  xml: string,
  options: { knownProperties?: CommerceMlPropertyDictionary; publishDescriptions?: boolean } = {},
): CatalogParseResult {
  const root = requireRoot(parseDocument(xml));
  const headerRows: OneCCatalogRow[] = [];
  const bodyRows: OneCCatalogRow[] = [];
  const productExternalIds: string[] = [];

  const classifierNode = findChild(root, "Классификатор");
  const classifierGroups = classifierNode ? findChild(classifierNode, "Группы") : undefined;
  if (classifierGroups) collectCategories(classifierGroups, null, 0, headerRows);
  // A goods file of a split export may arrive without <Свойства>; the
  // definitions stored from an earlier file of the same base fill the gap.
  const properties: CommerceMlPropertyDictionary = { ...options.knownProperties };
  collectProperties(classifierNode, properties);
  for (const [id, name] of collectWarehouseNames(classifierNode)) headerRows.push(buildExchangeWarehouseRow(id, name));

  const catalogNode = findChild(root, "Каталог");
  const info = readRootInfo(root, catalogNode ?? classifierNode);
  const productsNode = catalogNode ? findChild(catalogNode, "Товары") : undefined;
  const brandNames = new Map<string, string>();
  if (productsNode) {
    for (const productNode of findChildren(productsNode, "Товар")) {
      const parsed = parseProduct(productNode, properties, options.publishDescriptions === true);
      if (!parsed) continue;
      bodyRows.push(parsed.row);
      productExternalIds.push(parsed.row.externalId);
      if (parsed.brandName) {
        const brandExternalId = buildBrandExternalId(parsed.brandName);
        if (!brandNames.has(brandExternalId)) brandNames.set(brandExternalId, parsed.brandName);
      }
    }
  }
  for (const [externalId, name] of brandNames) {
    headerRows.push({
      entityType: "brand", externalId, isActive: true, name, slug: buildSlug(name, externalId), version: 1,
    });
  }

  return { ...info, bodyRows, headerRows, productExternalIds, properties };
}

/**
 * Parses an offers-type file -- offers*.xml, and the separate prices*.xml /
 * rests*.xml that CommerceML 2.08+ exchanges send -- into price rows and
 * per-warehouse stock rows.
 */
export function parseOffersXml(xml: string, options: { priceTypeName?: string } = {}): OffersParseResult {
  const root = requireRoot(parseDocument(xml));
  const packageNode = findChild(root, "ПакетПредложений");
  const info = readRootInfo(root, packageNode);
  const priceType = selectPriceType(packageNode, options.priceTypeName);
  const offersNode = packageNode ? findChild(packageNode, "Предложения") : undefined;
  const warehouseNames = collectWarehouseNames(packageNode, findChild(root, "Классификатор"));

  // One price per product (characteristic offers "product#characteristic"
  // belong to the product; the first valid price stands for it) and stock
  // summed per (product, warehouse).
  const prices = new Map<string, Extract<OneCCatalogRow, { entityType: "price" }>>();
  const stocks = new Map<string, Map<string, number>>();
  const productsWithBreakdown = new Set<string>();
  const referencedWarehouses = new Set<string>();
  if (offersNode) {
    for (const offerNode of findChildren(offersNode, "Предложение")) {
      const productExternalId = textOf(findChild(offerNode, "Ид"))?.split("#")[0]?.trim();
      if (!productExternalId) continue;
      const price = parseOfferPrice(offerNode, productExternalId, priceType);
      if (price && !prices.has(productExternalId)) prices.set(productExternalId, price);
      const stock = parseOfferStock(offerNode);
      const entries: Array<[string, number]> = stock.byWarehouse.size > 0
        ? [...stock.byWarehouse]
        : stock.total !== null ? [[EXCHANGE_WAREHOUSE_EXTERNAL_ID, stock.total]] : [];
      if (stock.byWarehouse.size > 0) productsWithBreakdown.add(productExternalId);
      for (const [warehouseId, quantity] of entries) {
        const perProduct = stocks.get(productExternalId) ?? new Map<string, number>();
        perProduct.set(warehouseId, Math.min((perProduct.get(warehouseId) ?? 0) + quantity, 2_147_483_647));
        stocks.set(productExternalId, perProduct);
        if (warehouseId !== EXCHANGE_WAREHOUSE_EXTERNAL_ID) referencedWarehouses.add(warehouseId);
      }
    }
  }
  // A product that now reports named warehouses must not keep an older flat
  // figure on the synthetic warehouse, or the shop would count it twice. The
  // zero row only touches an existing synthetic balance (see applyStock).
  for (const productExternalId of productsWithBreakdown) {
    const perProduct = stocks.get(productExternalId)!;
    if (!perProduct.has(EXCHANGE_WAREHOUSE_EXTERNAL_ID)) perProduct.set(EXCHANGE_WAREHOUSE_EXTERNAL_ID, 0);
  }

  const stockRows = (productExternalId: string): OneCCatalogRow[] => [...(stocks.get(productExternalId) ?? [])]
    .map(([warehouseExternalId, quantityOnHand]) => ({
      entityType: "stock" as const, productExternalId, quantityOnHand, version: 1, warehouseExternalId,
    }));
  const bodyRows: OneCCatalogRow[] = [];
  for (const [productExternalId, price] of prices) bodyRows.push(price, ...stockRows(productExternalId));
  for (const productExternalId of stocks.keys()) {
    if (!prices.has(productExternalId)) bodyRows.push(...stockRows(productExternalId));
  }

  const headerRows: OneCCatalogRow[] = [WAREHOUSE_ROW];
  for (const warehouseId of referencedWarehouses) {
    headerRows.push(buildExchangeWarehouseRow(warehouseId, warehouseNames.get(warehouseId)));
  }
  return { ...info, bodyRows, carriesStock: stocks.size > 0, headerRows, priceTypeName: priceType.kind === "type" ? priceType.name : null };
}
