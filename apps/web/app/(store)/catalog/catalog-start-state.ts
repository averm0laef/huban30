export function isCatalogStartState(query: string, hasFilters: boolean): boolean {
  return query.trim().length === 0 && !hasFilters;
}

export function shouldShowCatalogFilterRail(startState: boolean, treeCount: number, brandCount: number): boolean {
  return !startState || treeCount > 0 || brandCount > 0;
}
