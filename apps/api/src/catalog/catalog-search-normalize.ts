import { foldYo, normalizeSearchQuery } from "@an30/contracts";

// Re-exported from @an30/contracts, which is the single implementation now
// shared with apps/worker (article-cross ingestion needs the exact same
// article/brand fold that catalog search and the sku_normalized generated
// column already use -- see migration 0016 and 0018, and
// packages/contracts/src/catalog-search-normalize.ts for the actual code).
// This file exists only so the existing relative imports throughout
// apps/api (catalog-public.service.ts, one-c-exchange-slug.ts,
// commerce-ml.parser.ts, and their tests) did not need to change.
export {
  alternateSearchQueries,
  foldHomoglyphs,
  foldYo,
  normalizeArticleNumber,
  normalizeBrand,
  normalizeSearchQuery,
  searchTokens,
  swapKeyboardLayoutToCyrillic,
  swapKeyboardLayoutToLatin,
  transliterateLatinToCyrillic,
} from "@an30/contracts";

const partsAliases: Readonly<Record<string, string>> = {
  "акб": "аккумулятор",
  "дворник": "щетка стеклоочистителя",
  "дворники": "щетка стеклоочистителя",
  "омывайка": "жидкость стеклоомывателя",
  "омыватель стекла": "жидкость стеклоомывателя",
};

/** Keep replacements exact so a mixed search retains its vehicle and part constraints. */
export function catalogPartsAlias(raw: string): string | undefined {
  const key = foldYo(normalizeSearchQuery(raw).toLowerCase());
  return Object.hasOwn(partsAliases, key) ? partsAliases[key] : undefined;
}
