// OpenSearch index for catalog search (docs/SEARCH_ENGINE.md). Built-in
// analysis only (no plugins), so the stock opensearchproject/opensearch
// image works:
//
//   - name.ru      Russian Snowball stemmer, ё folded to е
//   - name.prefix  edge n-grams: "тормоз" finds "тормозные", "фильт" finds "фильтр"
//   - name         plain words (layout/brand/typo alternatives come from the
//                  API's search plan, apps/api/src/catalog/catalog-search-tokens.ts)
//   - sku_normalized  the 1C article folded like app.normalize_article
//                  (case, Cyrillic look-alikes, spaces/dots/hyphens/slashes),
//                  plus .fragment n-grams for "914/2" inside "W 914/2"
//   - measures     canonical keys ("visc:5w40", "4л", "600мм", "num:60")
//
// The field names are the contract with apps/api/src/catalog/catalog-search-engine.ts.

const HOMOGLYPHS = ["А", "В", "Е", "К", "М", "Н", "О", "Р", "С", "Т", "У", "Х"];
const LATIN = ["a", "b", "e", "k", "m", "h", "o", "p", "c", "t", "y", "x"];

export const SEARCH_INDEX_DEFINITION = {
  settings: {
    index: { number_of_shards: 1, number_of_replicas: 0, max_ngram_diff: 18, refresh_interval: "1s" },
    analysis: {
      char_filter: {
        yo: { type: "mapping", mappings: ["ё => е", "Ё => Е"] },
        article_strip: { type: "pattern_replace", pattern: "[\\s.\\-/]+", replacement: "" },
        homoglyph: {
          type: "mapping",
          mappings: HOMOGLYPHS.flatMap((letter, index) => [`${letter} => ${LATIN[index]}`, `${letter.toLowerCase()} => ${LATIN[index]}`]),
        },
      },
      filter: {
        ru_stemmer: { type: "stemmer", language: "russian" },
        prefix_ngram: { type: "edge_ngram", min_gram: 2, max_gram: 20 },
        fragment_ngram: { type: "ngram", min_gram: 3, max_gram: 20 },
      },
      normalizer: {
        article: { type: "custom", char_filter: ["article_strip", "homoglyph"], filter: ["lowercase"] },
        folded: { type: "custom", char_filter: ["yo"], filter: ["lowercase"] },
      },
      analyzer: {
        plain: { type: "custom", tokenizer: "standard", char_filter: ["yo"], filter: ["lowercase"] },
        ru: { type: "custom", tokenizer: "standard", char_filter: ["yo"], filter: ["lowercase", "ru_stemmer"] },
        ru_prefix: { type: "custom", tokenizer: "standard", char_filter: ["yo"], filter: ["lowercase", "prefix_ngram"] },
        article_fragment: { type: "custom", tokenizer: "keyword", char_filter: ["article_strip", "homoglyph"], filter: ["lowercase", "fragment_ngram"] },
        article_search: { type: "custom", tokenizer: "keyword", char_filter: ["article_strip", "homoglyph"], filter: ["lowercase"] },
      },
    },
  },
  mappings: {
    dynamic: "strict",
    properties: {
      id: { type: "keyword" },
      sku: { type: "keyword" },
      sku_normalized: {
        type: "keyword",
        normalizer: "article",
        fields: { fragment: { type: "text", analyzer: "article_fragment", search_analyzer: "article_search" } },
      },
      name: {
        type: "text",
        analyzer: "plain",
        fields: {
          ru: { type: "text", analyzer: "ru" },
          prefix: { type: "text", analyzer: "ru_prefix", search_analyzer: "plain" },
        },
      },
      lead: { type: "keyword", normalizer: "folded" },
      name_sort: { type: "keyword", normalizer: "folded" },
      brand: { type: "text", analyzer: "plain" },
      brand_slug: { type: "keyword" },
      brand_key: { type: "keyword" },
      category_path: { type: "keyword" },
      price_kopeks: { type: "long" },
      available_quantity: { type: "integer" },
      in_stock: { type: "boolean" },
      measures: { type: "keyword" },
      created_at: { type: "date" },
    },
  },
} as const;
