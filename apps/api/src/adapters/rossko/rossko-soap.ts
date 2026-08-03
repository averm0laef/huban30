import { createHash } from "node:crypto";

import type { SupplierPart, SupplierSearchResult, SupplierStock } from "../provider-contracts.js";

// Rossko GetSearch, verified live against https://api.rossko.ru/service/v2.1/:
//   targetNamespace = https://api.rossko.ru/, SOAPAction = "https://api.rossko.ru/GetSearch".
// The v1 endpoint on chita.rossko.ru is closed; do not fall back to it.
export const ROSSKO_ENDPOINT = "https://api.rossko.ru/service/v2.1/";
export const ROSSKO_NAMESPACE = "https://api.rossko.ru/";
export const ROSSKO_SOAP_ACTION = "https://api.rossko.ru/GetSearch";

const CACHE_KEY_PREFIX = "an30:rossko:search:";

// A defensive cap, not a real-world limit: one measured response for a common
// part number returned ~140 KB and 102 parts, so these bounds only exist to
// stop a malformed or hostile payload from allocating an unbounded tree.
const MAX_TOP_LEVEL_PARTS = 500;
const MAX_STOCKS_PER_PART = 50;
const MAX_CROSSES_PER_PART = 50;
const MAX_PART_DEPTH = 6;
const MAX_XML_NODE_VISITS = 20_000;

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
    if (findChild(node, "success") && findChild(node, "message")) return node;
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
  const value = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function parseStock(node: XmlNode): SupplierStock | null {
  const priceRaw = findChild(node, "price")?.text;
  if (priceRaw === undefined) return null;
  const priceKopeks = parsePriceToKopeks(priceRaw);
  // A stock line with an unparseable price is dropped rather than rounded,
  // coerced or allowed to crash the whole search — see parsePriceToKopeks.
  if (priceKopeks === null) return null;
  const deliveryTime = findChild(node, "delivery_time")?.text;
  return {
    deliveryTime: deliveryTime && deliveryTime.length > 0 ? deliveryTime : null,
    id: findChild(node, "id")?.text ?? "",
    priceKopeks,
    quantity: parseNonNegativeInt(findChild(node, "count")?.text),
  };
}

function parsePart(node: XmlNode, depth: number): SupplierPart {
  const stocksNode = findChild(node, "stocks");
  const stocks = stocksNode
    ? findChildren(stocksNode, "Stock")
      .slice(0, MAX_STOCKS_PER_PART)
      .map(parseStock)
      .filter((stock): stock is SupplierStock => stock !== null)
    : [];
  const crossesNode = depth < MAX_PART_DEPTH ? findChild(node, "crosses") : undefined;
  const crosses = crossesNode
    ? findChildren(crossesNode, "Part")
      .slice(0, MAX_CROSSES_PER_PART)
      .map((child) => parsePart(child, depth + 1))
    : [];
  return {
    brand: findChild(node, "brand")?.text ?? "",
    crosses,
    guid: findChild(node, "guid")?.text ?? "",
    name: findChild(node, "name")?.text ?? "",
    partNumber: findChild(node, "partnumber")?.text ?? "",
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
    const message = findChild(resultNode, "message")?.text ?? "";
    const partsListNode = findChild(resultNode, "PartsList");
    const parts = partsListNode
      ? findChildren(partsListNode, "Part")
        .slice(0, MAX_TOP_LEVEL_PARTS)
        .map((node) => parsePart(node, 0))
      : [];
    return { message, parts, success };
  } catch {
    return { message: "Не удалось разобрать ответ поставщика", parts: [], success: false };
  }
}
