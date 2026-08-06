// Minimal, defensive, exception-free-to-callers XML reader for CommerceML 2
// documents (1C "Обмен с сайтом"). Deliberately hand-rolled rather than an XML
// dependency, following the same approach as
// apps/api/src/adapters/rossko/rossko-soap.ts: parse into a small node tree,
// then walk it by tag name. Any malformed input throws XmlParseError, which
// every caller in this directory turns into a clean rejection instead of a
// crash — see CommerceMlParseError in commerce-ml.parser.ts.
//
// A 30-40k SKU catalog export can carry several hundred thousand elements, so
// the safety caps here are generous compared to rossko-soap.ts's (which only
// ever parses one supplier search response), not tightened.

export class XmlParseError extends Error {}

export interface XmlNode {
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

const MAX_XML_DEPTH = 300;
const MAX_XML_NODE_VISITS = 4_000_000;

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

export function localName(tag: string): string {
  const index = tag.indexOf(":");
  return index === -1 ? tag : tag.slice(index + 1);
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/u.test(character);
}

let visitBudget = 0;

/**
 * Parses a full XML document into a tree of {@link XmlNode}. Throws
 * {@link XmlParseError} on anything malformed — an unterminated tag, a
 * mismatched close tag, a truncated document — rather than returning a
 * partial tree, so a corrupt upload can never silently feed partial data
 * into the catalog.
 */
export function parseXmlDocument(input: string): XmlNode {
  const length = input.length;
  let position = 0;
  visitBudget = MAX_XML_NODE_VISITS;

  function fail(message: string): never {
    throw new XmlParseError(`${message} at position ${position}`);
  }

  function spendVisit(): void {
    visitBudget -= 1;
    if (visitBudget <= 0) fail("Document has too many elements");
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
    if (depth > MAX_XML_DEPTH) fail("XML nesting too deep");
    spendVisit();
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
  if (position < length) fail("Unexpected content after root element");
  return root;
}

export function findChild(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((child) => localName(child.tag) === name);
}

export function findChildren(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((child) => localName(child.tag) === name);
}
