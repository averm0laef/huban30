import { describe, expect, it } from "vitest";

import type { CatalogCategoryNode } from "@an30/contracts";

import {
  buildCategoryBreadcrumb,
  categoryPath,
  findCategorySlugPath,
  resolveCategoryPath,
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
