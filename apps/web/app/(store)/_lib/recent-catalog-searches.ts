const storageKey = "an30:catalog:recent-searches";
const limit = 5;

function rememberable(value: string) {
  return value.length >= 2 && value.length <= 120 &&
    !/[\u0000-\u001f@]/u.test(value) &&
    !/^[A-Z0-9]{17}$/iu.test(value.replace(/\s/gu, "")) &&
    !/^(?:\+?7|8)?[\s().-]*\d(?:[\s().-]*\d){9}$/u.test(value);
}

export function readRecentCatalogSearches(): string[] {
  try {
    const stored: unknown = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(stored) ? stored.filter((value): value is string => typeof value === "string" && rememberable(value)).slice(0, limit) : [];
  } catch {
    return [];
  }
}

export function rememberCatalogSearch(query: string) {
  const compact = query.trim().replace(/\s+/gu, " ");
  if (!rememberable(compact)) return;
  const searches = readRecentCatalogSearches();
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify([compact, ...searches.filter(value => value.toLowerCase() !== compact.toLowerCase())].slice(0, limit)));
  } catch {
    // Search still works without browser storage.
  }
}

export function clearRecentCatalogSearches() {
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // Storage may be unavailable in private browsing.
  }
}
