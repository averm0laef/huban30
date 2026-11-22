import { describe, expect, it } from "vitest";

import type { CatalogCategoryNode } from "@an30/contracts";

import {
  buildCategoryBreadcrumb,
  categoryPath,
  findCategorySlugPath,
  resolveCategoryPath,
  resolveParentLink,
  resolveTaxonomyPath,
} from "./catalog-tree";

function node(overrides: Partial<CatalogCategoryNode> & Pick<CatalogCategoryNode, "id" | "name" | "slug">): CatalogCategoryNode {
  return {
    children: [],
    description: null,
    productCount: 0,
    sortOrder: 0,
    ...overrides,
  };
}

const tree: CatalogCategoryNode[] = [
  node({
    children: [
      node({
        children: [
          node({ id: "wipers", name: "Щётки", slug: "shchetki" }),
        ],
        id: "body",
        name: "Кузов",
        slug: "kuzov",
      }),
    ],
    id: "parts",
    name: "Запчасти",
    slug: "zapchasti",
  }),
  node({ id: "oils", name: "Масла", slug: "masla" }),
];

describe("resolveCategoryPath", () => {
  it("resolves a deep path and returns its ancestors in order", () => {
    const location = resolveCategoryPath(tree, ["zapchasti", "kuzov", "shchetki"]);

    expect(location?.node.id).toBe("wipers");
    expect(location?.ancestors.map((entry) => entry.id)).toEqual(["parts", "body"]);
  });

  it("resolves a top-level category with no ancestors", () => {
    const location = resolveCategoryPath(tree, ["masla"]);

    expect(location?.node.id).toBe("oils");
    expect(location?.ancestors).toEqual([]);
  });

  it("returns null when a segment does not exist at that level", () => {
    expect(resolveCategoryPath(tree, ["zapchasti", "does-not-exist"])).toBeNull();
    expect(resolveCategoryPath(tree, ["masla", "kuzov"])).toBeNull();
  });

  it("returns null for an empty path", () => {
    expect(resolveCategoryPath(tree, [])).toBeNull();
  });
});

describe("categoryPath", () => {
  it("joins the slug chain under /catalog", () => {
    expect(categoryPath(["zapchasti", "kuzov", "shchetki"])).toBe("/catalog/zapchasti/kuzov/shchetki");
  });

  it("encodes each segment independently", () => {
    expect(categoryPath(["a b"])).toBe("/catalog/a%20b");
  });
});

describe("buildCategoryBreadcrumb", () => {
  it("builds Главная / Каталог / ancestors / self with linkable paths", () => {
    const location = resolveCategoryPath(tree, ["zapchasti", "kuzov", "shchetki"]);
    const trail = buildCategoryBreadcrumb(location!.ancestors, location!.node);

    expect(trail).toEqual([
      { name: "Главная", path: "/" },
      { name: "Каталог", path: "/catalog" },
      { name: "Запчасти", path: "/catalog/zapchasti" },
      { name: "Кузов", path: "/catalog/zapchasti/kuzov" },
      { name: "Щётки", path: "/catalog/zapchasti/kuzov/shchetki" },
    ]);
  });

  it("builds a two-entry trail for a top-level category", () => {
    const location = resolveCategoryPath(tree, ["masla"]);
    const trail = buildCategoryBreadcrumb(location!.ancestors, location!.node);

    expect(trail).toEqual([
      { name: "Главная", path: "/" },
      { name: "Каталог", path: "/catalog" },
      { name: "Масла", path: "/catalog/masla" },
    ]);
  });
});

describe("resolveParentLink", () => {
  it("points a top-level category up at the catalog root", () => {
    const location = resolveCategoryPath(tree, ["masla"]);
    expect(resolveParentLink(location!.ancestors)).toEqual({ name: "Все категории", path: "/catalog" });
  });

  it("points a nested category up at its immediate parent, not the root", () => {
    const location = resolveCategoryPath(tree, ["zapchasti", "kuzov", "shchetki"]);
    expect(resolveParentLink(location!.ancestors)).toEqual({ name: "Кузов", path: "/catalog/zapchasti/kuzov" });
  });

  it("falls back to the catalog root for an empty ancestor list", () => {
    expect(resolveParentLink([])).toEqual({ name: "Все категории", path: "/catalog" });
  });
});

describe("findCategorySlugPath", () => {
  it("finds a deeply nested category by slug alone", () => {
    expect(findCategorySlugPath(tree, "shchetki")).toEqual(["zapchasti", "kuzov", "shchetki"]);
  });

  it("finds a top-level category", () => {
    expect(findCategorySlugPath(tree, "masla")).toEqual(["masla"]);
  });

  it("returns null when nothing matches, so callers can fall back to search", () => {
    expect(findCategorySlugPath(tree, "does-not-exist")).toBeNull();
  });

  it("returns null against an empty tree (catalog not imported yet)", () => {
    expect(findCategorySlugPath([], "masla")).toBeNull();
  });
});

// The public tree lists only the sections that have products. A link from /podbor into «Фильтры → Масляные»
// (and any old bookmark) on a shop whose filters were not loaded yet answered «404 — такой страницы нет».
describe("a section of the shop's own taxonomy that has no products yet", () => {
  it("is found by its place in the taxonomy, with nothing in it", () => {
    const location = resolveTaxonomyPath(["filtry", "maslyanye-filtry"]);
    expect(location?.node).toMatchObject({ children: [], name: "Масляные", productCount: 0, slug: "maslyanye-filtry" });
    expect(location?.ancestors.map((entry) => [entry.slug, entry.name])).toEqual([["filtry", "Фильтры"]]);
  });

  it("is found as a whole section too, without subsections to offer", () => {
    const location = resolveTaxonomyPath(["filtry"]);
    expect(location?.node).toMatchObject({ children: [], name: "Фильтры", productCount: 0, slug: "filtry" });
    expect(location?.ancestors).toEqual([]);
  });

  it("is not made of a path the taxonomy does not have", () => {
    expect(resolveTaxonomyPath(["net-takogo-razdela"])).toBeNull();
    expect(resolveTaxonomyPath(["filtry", "net-takogo-podrazdela"])).toBeNull();
    expect(resolveTaxonomyPath(["filtry", "maslyanye-filtry", "glubzhe"])).toBeNull();
    expect(resolveTaxonomyPath([])).toBeNull();
  });

  it("is not made of a subsection put in the wrong place", () => {
    // «Масляные» belong to «Фильтры»: neither a root nor a part of «Тормозная система».
    expect(resolveTaxonomyPath(["maslyanye-filtry"])).toBeNull();
    expect(resolveTaxonomyPath(["tormoznaya-sistema", "maslyanye-filtry"])).toBeNull();
  });

  it("does not open the staff's own shelves", () => {
    expect(resolveTaxonomyPath(["bez-kategorii"])).toBeNull();
    expect(resolveTaxonomyPath(["ne-pokazyvat-na-sayte"])).toBeNull();
  });
});
