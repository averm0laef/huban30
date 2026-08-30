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
  swapKeyboardLayoutToCyrillic,
  transliterateLatinToCyrillic,
} from "@an30/contracts";
