export const EXPERT_HELP_CATALOG_QUERY_STORAGE_KEY = "an30:expert-help:catalog-query-prefill";
export const EXPERT_HELP_PRODUCT_STORAGE_KEY = "an30:expert-help:product-prefill";

export function catalogQueryPrefillMessage(query: string): string {
  const normalized = query.trim();
  return `Ищу деталь: ${normalized}\nАвтомобиль: `;
}

export function productCompatibilityPrefillMessage(name: string, sku: string): string {
  return `Проверьте совместимость детали «${name.trim()}», артикул ${sku.trim()}.\nАвтомобиль: `;
}
