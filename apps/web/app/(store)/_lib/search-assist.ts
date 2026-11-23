/**
 * Client-side helpers for the header search popup: the wrong-keyboard-layout
 * hint, matching catalog sections, and the highlight of the typed text in a
 * product name. Pure functions, no DOM, so they are unit-tested directly.
 */

const LATIN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const CYRILLIC = "йцукенгшщзхъфывапролджэячсмитьбюё";

const latinToCyrillic = new Map<string, string>();
const cyrillicToLatin = new Map<string, string>();
for (let index = 0; index < LATIN.length; index += 1) {
  latinToCyrillic.set(LATIN[index]!, CYRILLIC[index]!);
  cyrillicToLatin.set(CYRILLIC[index]!, LATIN[index]!);
}

/**
 * "vfckj" → "масло": the query re-typed as if the other keyboard layout had
 * been active. Only offered when the search found nothing, so a real brand
 * that happens to be all-Latin ("bosch") is never "corrected" over results.
 * Returns null unless every letter belongs to one layout.
 */
export function swapKeyboardLayout(query: string): string | null {
  const text = query.trim().toLowerCase();
  const letters = [...text].filter((char) => /\p{L}/u.test(char));
  if (letters.length < 3) return null;
  const latin = letters.every((char) => latinToCyrillic.has(char));
  const cyrillic = letters.every((char) => cyrillicToLatin.has(char));
  if (latin === cyrillic) return null;
  const map = latin ? latinToCyrillic : cyrillicToLatin;
  const swapped = [...text].map((char) => map.get(char) ?? char).join("");
  // A real word has vowels; "ывап" → "sdfg" is keyboard mashing, not a typo.
  const vowels = latin ? /[аеёиоуыэюя]/u : /[aeiouy]/u;
  return swapped === text || !vowels.test(swapped) ? null : swapped;
}

export interface FlatCategory {
  id: string;
  name: string;
  parentId: string | null;
  productCount: number;
  slug: string;
}

export interface CategoryMatch {
  href: string;
  name: string;
  parentName: string | null;
  productCount: number;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/ё/gu, "е").trim();
}

/** Russian words share a stem across cases: "фильтр", "фильтры", "фильтров". */
function stem(word: string): string {
  return word.length > 5 ? word.slice(0, word.length - 2) : word.length > 3 ? word.slice(0, word.length - 1) : word;
}

/**
 * Catalog sections whose name contains every typed word (by stem), most
 * stocked first. Empty sections are skipped: a suggestion that opens an
 * empty page is worse than none.
 */
export function matchCategories(categories: readonly FlatCategory[], query: string, limit = 3): CategoryMatch[] {
  const words = normalize(query).split(/[\s,.;/-]+/u).filter((word) => word.length >= 2).map(stem);
  if (words.length === 0) return [];
  const byId = new Map(categories.map((category) => [category.id, category]));
  const pathOf = (category: FlatCategory): string[] => {
    const chain: string[] = [];
    let current: FlatCategory | undefined = category;
    let guard = 0;
    while (current && guard < 12) {
      chain.unshift(current.slug);
      current = current.parentId ? byId.get(current.parentId) : undefined;
      guard += 1;
    }
    return chain;
  };
  return categories
    .filter((category) => category.productCount > 0)
    .filter((category) => {
      const name = normalize(category.name);
      return words.every((word) => name.includes(word));
    })
    .sort((a, b) => b.productCount - a.productCount)
    .slice(0, limit)
    .map((category) => ({
      href: `/catalog/${pathOf(category).map(encodeURIComponent).join("/")}`,
      name: category.name,
      parentName: category.parentId ? byId.get(category.parentId)?.name ?? null : null,
      productCount: category.productCount,
    }));
}

export interface HighlightPart { match: boolean; text: string }

/** Splits `text` so every occurrence of a typed word (ё-insensitive) is marked. */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const words = normalize(query).split(/\s+/u).filter((word) => word.length >= 2);
  if (words.length === 0) return [{ match: false, text }];
  const haystack = normalize(text);
  const marks = new Array<boolean>(text.length).fill(false);
  for (const word of words) {
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(word, from);
      if (at < 0) break;
      for (let index = at; index < at + word.length; index += 1) marks[index] = true;
      from = at + word.length;
    }
  }
  const parts: HighlightPart[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const last = parts.at(-1);
    if (last && last.match === marks[index]) last.text += text[index];
    else parts.push({ match: marks[index]!, text: text[index]! });
  }
  return parts;
}

/** The nested category tree as a flat list with parent ids. */
export function flattenCategoryTree(
  nodes: ReadonlyArray<{ children: ReadonlyArray<unknown>; id: string; name: string; productCount: number; slug: string }>,
  parentId: string | null = null,
): FlatCategory[] {
  const out: FlatCategory[] = [];
  for (const node of nodes) {
    out.push({ id: node.id, name: node.name, parentId, productCount: node.productCount, slug: node.slug });
    out.push(...flattenCategoryTree(node.children as typeof nodes, node.id));
  }
  return out;
}

/** "/catalog/filtry/maslyanye" for a category slug, or null when it is not in the tree. */
export function categoryHrefBySlug(categories: readonly FlatCategory[], slug: string): string | null {
  const byId = new Map(categories.map((category) => [category.id, category]));
  let current = categories.find((category) => category.slug === slug);
  if (!current) return null;
  const chain: string[] = [];
  for (let guard = 0; current && guard < 12; guard += 1) {
    chain.unshift(current.slug);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return `/catalog/${chain.map(encodeURIComponent).join("/")}`;
}

/**
 * The section a query *names* — "аккумулятор", "фильтры", "моторное масло" —
 * as opposed to a product search ("масляный фильтр W914/2"). Every word must
 * match the section name word for word (by stem, ё-insensitive) and the word
 * counts must agree, so "масляный фильтр" never jumps into «Фильтры». Only a
 * section that has products (its own or its subsections') is opened.
 */
export function exactCategoryMatch(categories: readonly FlatCategory[], query: string): FlatCategory | null {
  const split = (value: string) => normalize(value).split(/[\s,.;/-]+/u).filter(Boolean).map(stem);
  const words = split(query);
  if (words.length === 0 || words.length > 3) return null;
  const same = (a: string, b: string) => a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a));
  const hits = categories.filter((category) => {
    // An empty section answers «В разделе пока нет товаров» while the product sits elsewhere: search by the word instead.
    if (category.productCount <= 0) return false;
    const name = split(category.name);
    return name.length === words.length && name.every((word, index) => same(word, words[index]!));
  });
  if (hits.length === 0) return null;
  return hits.sort((a, b) => b.productCount - a.productCount)[0] ?? null;
}
