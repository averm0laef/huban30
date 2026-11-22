/**
 * Search text as one line: tabs, line breaks and non-breaking spaces from a
 * pasted article ("W914\t2") become single spaces, so the catalog API never
 * rejects the search as malformed. Capped at the API's 120 characters.
 */
export function normalizeCatalogSearchText(value: string): string {
  return value.replace(/[\s\u0000-\u001f\u007f]+/gu, " ").trim().slice(0, 120).trim();
}

/** Build the same query URL used by the header's GET /catalog form. */
export function catalogSearchHref(query: string): string {
  const parameters = new URLSearchParams({ q: normalizeCatalogSearchText(query) });
  return `/catalog?${parameters.toString()}`;
}
