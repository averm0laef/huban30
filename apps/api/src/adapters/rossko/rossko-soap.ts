import { createHash } from "node:crypto";

import type { SupplierPart, SupplierSearchResult, SupplierStock } from "../provider-contracts.js";

// Rossko GetSearch, verified against the live v2.1 WSDL:
//   targetNamespace = https://api.rossko.ru/,
//   SOAPAction = "https://api.rossko.ru/service/v2.1/GetSearch".
// The v1 endpoint on chita.rossko.ru is closed; do not fall back to it.
//
// The operation name is part of the path — the WSDL publishes
// soap:address location="https://api.rossko.ru/service/v2.1/GetSearch".
// Posting to the bare service/v2.1/ directory answers HTTP 404.
export const ROSSKO_ENDPOINT = "https://api.rossko.ru/service/v2.1/GetSearch";
export const ROSSKO_NAMESPACE = "https://api.rossko.ru/";
export const ROSSKO_SOAP_ACTION = "https://api.rossko.ru/service/v2.1/GetSearch";

const CACHE_KEY_PREFIX = "an30:rossko:search:";

// A defensive cap, not a real-world limit: one measured response for a common
// part number returned ~140 KB and 102 parts, so these bounds only exist to
// stop a malformed or hostile payload from allocating an unbounded tree.
const MAX_TOP_LEVEL_PARTS = 500;
const MAX_STOCKS_PER_PART = 50;
// A live answer for one oil filter number carried 78 analogs under a single
// part: a cap of 50 silently dropped the rest from the shop's cross base.
export const MAX_CROSSES_PER_PART = 300;
const MAX_PART_DEPTH = 6;
// A live answer of 581 KB (450 parts, 1 285 stock lines) is 16 800 nodes, so
// a 20 000 ceiling refused only slightly broader, valid answers. The body is
// already limited to 5 MiB by the provider.
const MAX_XML_NODE_VISITS = 100_000;
const MAX_STOCK_QUANTITY = 1_000_000;

export interface RosskoSearchParams {
  addressId?: string;
  deliveryId: string;
  key1: string;
  key2: string;
  text: string;
}

/**
 * Escapes a value for safe interpolation into XML element content. Every
 * value that goes into the hand-built envelope (search text, keys, delivery
 * id) must pass through this — a part number containing `&` or `<` must not
 * break the envelope or let the customer inject sibling elements.
 */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

/**
 * Builds the GetSearch SOAP 1.1 envelope by hand (no SOAP client dependency).
 * Element order matters to the Rossko service and must stay exactly
 * KEY1, KEY2, text, delivery_id, (optional) address_id.
 */
export function buildGetSearchEnvelope(params: RosskoSearchParams): string {
  const addressElement = params.addressId
    ? `<address_id>${xmlEscape(params.addressId)}</address_id>`
    : "";
  return `<?xml version="1.0" encoding="utf-8"?>`
    + `<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" `
    + `xmlns:xsd="http://www.w3.org/2001/XMLSchema" `
    + `xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">`
    + `<soap:Body>`
    + `<GetSearch xmlns="${ROSSKO_NAMESPACE}">`
    + `<KEY1>${xmlEscape(params.key1)}</KEY1>`
    + `<KEY2>${xmlEscape(params.key2)}</KEY2>`
    + `<text>${xmlEscape(params.text)}</text>`
    + `<delivery_id>${xmlEscape(params.deliveryId)}</delivery_id>`
    + addressElement
    + `</GetSearch>`
    + `</soap:Body>`
    + `</soap:Envelope>`;
}

/**
 * Converts a Rossko price string (rubles, up to two decimal places) to
 * integer kopeks using pure string/integer arithmetic — never floating point
 * — so nothing is silently rounded. Anything that is not a clean, strictly
 * positive amount is rejected by returning null; callers must drop the stock
 * line rather than guess at a price.
 */
const PRICE_PATTERN = /^\d{1,12}(?:\.\d{1,2})?$/u;

export function parsePriceToKopeks(raw: string): number | null {
  const trimmed = raw.trim();
  if (!PRICE_PATTERN.test(trimmed)) return null;
  const [wholePart, fractionPart = ""] = trimmed.split(".");
  const kopeks = Number.parseInt(`${wholePart}${fractionPart.padEnd(2, "0")}`, 10);
  return Number.isSafeInteger(kopeks) && kopeks > 0 ? kopeks : null;
}

/** Normalises free-text supplier search input for both the outbound request and the cache key. */
export function normaliseSupplierQuery(raw: string): string {
  return raw.trim().replace(/\s+/gu, " ").toUpperCase();
}

/** Redis cache key for a normalised query. Includes the delivery id so a config change cannot serve a stale cross-delivery result. */
export function supplierCacheKey(normalisedQuery: string, deliveryId: string): string {
  const digest = createHash("sha256").update(`${deliveryId} ${normalisedQuery}`).digest("hex");
  return `${CACHE_KEY_PREFIX}${digest}`;
}

// ---------------------------------------------------------------------------
// Minimal, defensive XML reader. Rossko's SOAP body is parsed structurally
// (not with a full SOAP/XML dependency) into a small node tree, then walked
// by field name. Any malformed input throws XmlParseError, which the caller
// turns into a clean failure result instead of a crash.
// ---------------------------------------------------------------------------

export class XmlParseError extends Error {}

interface XmlNode {
  attributes: Record<string, string>;
  children: XmlNode[];
  tag: string;
  text: string;
}

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: '"',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/gu, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10_FFFF
        ? String.fromCodePoint(codePoint)
        : match;
    }
    if (entity.startsWith("#")) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10_FFFF
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return ENTITY_MAP[entity] ?? match;
  });
}

function localName(tag: string): string {
  const index = tag.indexOf(":");
  return index === -1 ? tag : tag.slice(index + 1);
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/u.test(character);
}

function parseXmlDocument(input: string): XmlNode {
  const length = input.length;
  let nodesParsed = 0;
  let position = 0;

  function fail(message: string): never {
    throw new XmlParseError(`${message} at position ${position}`);
  }

  function skipMisc(): void {
    for (;;) {
      while (position < length && isWhitespace(input[position])) position += 1;
      if (input.startsWith("<?", position)) {
        const end = input.indexOf("?>", position);
        if (end === -1) fail("Unterminated processing instruction");
        position = end + 2;
        continue;
      }
      if (input.startsWith("<!--", position)) {
        const end = input.indexOf("-->", position);
        if (end === -1) fail("Unterminated comment");
        position = end + 3;
        continue;
      }
      if (input.startsWith("<!", position)) {
        const end = input.indexOf(">", position);
        if (end === -1) fail("Unterminated declaration");
        position = end + 1;
        continue;
      }
      break;
    }
  }

  function parseAttributes(): Record<string, string> {
    const attributes: Record<string, string> = {};
    for (;;) {
      while (position < length && isWhitespace(input[position])) position += 1;
      if (position >= length || input[position] === ">" || input.startsWith("/>", position)) break;
      const nameMatch = /^[^\s=/>]+/u.exec(input.slice(position));
      if (!nameMatch) fail("Expected attribute name");
      const name = nameMatch[0];
      position += name.length;
      while (position < length && isWhitespace(input[position])) position += 1;
      if (input[position] !== "=") fail("Expected '=' after attribute name");
      position += 1;
      while (position < length && isWhitespace(input[position])) position += 1;
      const quote = input[position];
      if (quote !== "\"" && quote !== "'") fail("Expected quoted attribute value");
      position += 1;
      const end = input.indexOf(quote, position);
      if (end === -1) fail("Unterminated attribute value");
      attributes[name] = decodeEntities(input.slice(position, end));
      position = end + 1;
    }
    return attributes;
  }

  function parseElement(depth: number): XmlNode {
    if (depth > 200) fail("XML nesting too deep");
    nodesParsed += 1;
    if (nodesParsed > MAX_XML_NODE_VISITS) fail("XML document has too many nodes");
    if (input[position] !== "<") fail("Expected '<'");
    position += 1;
    const nameMatch = /^[^\s/>]+/u.exec(input.slice(position));
    if (!nameMatch) fail("Expected tag name");
    const tag = nameMatch[0];
    position += tag.length;
    const attributes = parseAttributes();
    if (input.startsWith("/>", position)) {
      position += 2;
      return { attributes, children: [], tag, text: "" };
    }
    if (input[position] !== ">") fail("Expected '>' to close start tag");
    position += 1;
    const children: XmlNode[] = [];
    let text = "";
    for (;;) {
      if (position >= length) fail("Unexpected end of document");
      if (input.startsWith("</", position)) {
        const closeMatch = /^<\/([^\s>]+)\s*>/u.exec(input.slice(position));
        if (!closeMatch) fail("Malformed closing tag");
        if (closeMatch[1] !== tag) fail(`Mismatched closing tag for <${tag}>`);
        position += closeMatch[0].length;
        break;
      }
      if (input.startsWith("<![CDATA[", position)) {
        const end = input.indexOf("]]>", position + 9);
        if (end === -1) fail("Unterminated CDATA section");
        text += input.slice(position + 9, end);
        position = end + 3;
        continue;
      }
      if (input.startsWith("<!--", position)) {
        const end = input.indexOf("-->", position);
        if (end === -1) fail("Unterminated comment");
        position = end + 3;
        continue;
      }
      if (input[position] === "<") {
        children.push(parseElement(depth + 1));
        continue;
      }
      const next = input.indexOf("<", position);
      if (next === -1) fail("Unexpected end of document");
      text += decodeEntities(input.slice(position, next));
      position = next;
    }
    return { attributes, children, tag, text: text.trim() };
  }

  skipMisc();
  if (position >= length) fail("Empty document");
  const root = parseElement(0);
  skipMisc();
  if (position !== length) fail("Unexpected content after root element");
  return root;
}

function findChild(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((child) => localName(child.tag) === name);
}

function findChildren(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((child) => localName(child.tag) === name);
}

/**
 * Finds the SearchResult node regardless of how deep the SOAP envelope
 * nests it (soap:Envelope/soap:Body/GetSearchResponse/GetSearchResult/...).
 * Rather than hard-coding that path, it looks for the first node that itself
 * carries the two fields every SearchResult always has.
 */
function findResultNode(root: XmlNode): XmlNode | undefined {
  const stack: XmlNode[] = [root];
  let visited = 0;
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    visited += 1;
    if (visited > MAX_XML_NODE_VISITS) return undefined;
    // `message` is only present when the call failed — a successful GetSearch
    // answers success/text/PartsList with no message at all. Requiring both
    // made the parser recognise error responses and nothing else.
    if (findChild(node, "success")) return node;
    for (const child of node.children) stack.push(child);
  }
  return undefined;
}

function parseBoolean(text: string): boolean | null {
  const normalized = text.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return null;
}

function parseNonNegativeInt(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const trimmed = raw.trim();
  // Number.parseInt("12abc") and Number.parseInt("1.5") both used to report
  // stock that Rossko never actually stated. Availability must fail closed:
  // only an entire decimal integer token is accepted.
  if (!/^\d+$/u.test(trimmed)) return 0;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value <= MAX_STOCK_QUANTITY ? value : 0;
}

function deliveryDate(raw: string | undefined): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}T/iu.test(raw) || !Number.isFinite(Date.parse(raw))) return null;
  const [year, month, day] = raw.slice(0, 10).split("-");
  return year && month && day ? `${day}.${month}.${year}` : null;
}

function parseDeliveryTime(node: XmlNode): string | null {
  // Kept for compatibility with the older payload captured in the existing
  // fixtures. The current v2.1 WSDL exposes deliveryStart/deliveryEnd instead.
  const legacy = findChild(node, "delivery_time")?.text;
  if (legacy && legacy.length <= 120) return legacy;
  const start = deliveryDate(findChild(node, "deliveryStart")?.text);
  const end = deliveryDate(findChild(node, "deliveryEnd")?.text);
  if (start && end) return start === end ? start : `${start}–${end}`;
  if (end) return `до ${end}`;
  if (start) return `с ${start}`;
  return null;
}

function parseStock(node: XmlNode): SupplierStock | null {
  const id = findChild(node, "id")?.text ?? "";
  // The public contract and wait-list lookup both require an opaque stock
  // id. Keeping an id-less line would make the browser reject the entire
  // otherwise-valid response and could never produce a resolvable request.
  if (id.length === 0 || id.length > 120) return null;
  const priceRaw = findChild(node, "price")?.text;
  if (priceRaw === undefined) return null;
  const priceKopeks = parsePriceToKopeks(priceRaw);
  // A stock line with an unparseable price is dropped rather than rounded,
  // coerced or allowed to crash the whole search — see parsePriceToKopeks.
  if (priceKopeks === null) return null;
  return {
    deliveryTime: parseDeliveryTime(node),
    id,
    priceKopeks,
    quantity: parseNonNegativeInt(findChild(node, "count")?.text),
  };
}

function parsePart(node: XmlNode, depth: number): SupplierPart | null {
  const brand = findChild(node, "brand")?.text ?? "";
  const guid = findChild(node, "guid")?.text ?? "";
  const name = findChild(node, "name")?.text ?? "";
  const partNumber = findChild(node, "partnumber")?.text ?? "";
  // guid and partnumber are load-bearing identifiers in the HTTP contract;
  // oversized display fields are equally invalid there. Drop only the bad
  // part instead of poisoning the complete supplier response in the browser.
  if (guid.length === 0 || guid.length > 200 || partNumber.length === 0 || partNumber.length > 200
    || brand.length > 200 || name.length > 500) return null;
  const stocksNode = findChild(node, "stocks");
  const stocks = stocksNode
    // The element is lowercase `stock`; `Stock` is only the WSDL type name.
    // Matching the type name silently produced price-less results for every
    // supplier part. `Part` really is capitalised, so it stays as it is.
    ? findChildren(stocksNode, "stock")
      .slice(0, MAX_STOCKS_PER_PART)
      .map(parseStock)
      .filter((stock): stock is SupplierStock => stock !== null)
    : [];
  const crossesNode = depth < MAX_PART_DEPTH ? findChild(node, "crosses") : undefined;
  const crosses = crossesNode
    ? findChildren(crossesNode, "Part")
      .slice(0, MAX_CROSSES_PER_PART)
      .map((child) => parsePart(child, depth + 1))
      .filter((part): part is SupplierPart => part !== null)
    : [];
  return {
    brand,
    crosses,
    guid,
    name,
    partNumber,
    stocks,
  };
}

/**
 * Parses a raw GetSearch SOAP response body. Never throws: any structural
 * problem (truncated body, unexpected shape, missing required fields)
 * produces a clean `{ success: false }` result instead of propagating an
 * exception up to the caller.
 */
export function parseSearchResponseXml(xml: string): SupplierSearchResult {
  try {
    const document = parseXmlDocument(xml);
    const resultNode = findResultNode(document);
    if (!resultNode) {
      return { message: "Поставщик вернул неожиданный ответ", parts: [], success: false };
    }
    const success = parseBoolean(findChild(resultNode, "success")?.text ?? "");
    if (success === null) {
      return { message: "Поставщик вернул неожиданный ответ", parts: [], success: false };
    }
    const message = (findChild(resultNode, "message")?.text ?? "").slice(0, 2_000);
    const partsListNode = findChild(resultNode, "PartsList");
    const parts = partsListNode
      ? findChildren(partsListNode, "Part")
        .slice(0, MAX_TOP_LEVEL_PARTS)
        .map((node) => parsePart(node, 0))
        .filter((part): part is SupplierPart => part !== null)
      : [];
    return { message, parts, success };
  } catch {
    return { message: "Не удалось разобрать ответ поставщика", parts: [], success: false };
  }
}
