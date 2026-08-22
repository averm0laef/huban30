import { describe, expect, it } from "vitest";

import {
  buildCategoryTree,
  resolveCategoryPath,
  type CategoryTreeRow,
} from "./catalog-category-tree.js";

function row(overrides: Partial<CategoryTreeRow> & Pick<CategoryTreeRow, "id" | "name" | "slug">): CategoryTreeRow {
  return {
    description: null,
    isActive: true,
    parentId: null,
    productCount: 1,
    sortOrder: 0,
    ...overrides,
  };
}

describe("buildCategoryTree", () => {
  it("nests multiple ancestor levels (Каталог / Запчасти / Кузов / Щётки)", () => {
    const rows: CategoryTreeRow[] = [
      row({ id: "parts", name: "Запчасти", slug: "zapchasti" }),
      row({ id: "body", name: "Кузов", parentId: "parts", slug: "kuzov" }),
      row({ id: "wipers", name: "Щётки", parentId: "body", slug: "shchetki" }),
    ];

    const tree = buildCategoryTree(rows);

    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ id: "parts", slug: "zapchasti" });
    expect(tree[0]?.children).toHaveLength(1);
    expect(tree[0]?.children[0]).toMatchObject({ id: "body", slug: "kuzov" });
    expect(tree[0]?.children[0]?.children).toHaveLength(1);
    expect(tree[0]?.children[0]?.children[0]).toMatchObject({ id: "wipers", slug: "shchetki" });
  });

  it("rolls direct product counts up through every ancestor", () => {
    const rows: CategoryTreeRow[] = [
      row({ id: "parts", name: "Запчасти", productCount: 1, slug: "zapchasti" }),
      row({ id: "body", name: "Кузов", parentId: "parts", productCount: 2, slug: "kuzov" }),
      row({ id: "wipers", name: "Щётки", parentId: "body", productCount: 5, slug: "shchetki" }),
      row({ id: "bumpers", name: "Бамперы", parentId: "body", productCount: 3, slug: "bampery" }),
    ];

    const tree = buildCategoryTree(rows);

    const parts = tree.find((node) => node.id === "parts");
    const body = parts?.children.find((node) => node.id === "body");
    const wipers = body?.children.find((node) => node.id === "wipers");

    // parts: own 1 + body's roll-up (2 + 5 + 3 = 10) = 11
    expect(parts?.productCount).toBe(11);
    // body: own 2 + wipers 5 + bumpers 3 = 10
    expect(body?.productCount).toBe(10);
    // leaf: just its own count
    expect(wipers?.productCount).toBe(5);
  });

  it("prunes empty technical branches but keeps an empty parent with populated descendants", () => {
    const rows: CategoryTreeRow[] = [
      row({ id: "smoke", name: "Smoke category", productCount: 0, slug: "smoke-category" }),
      row({ id: "parts", name: "Запчасти", productCount: 0, slug: "zapchasti" }),
      row({ id: "filters", name: "Фильтры", parentId: "parts", productCount: 2, slug: "filtry" }),
      row({ id: "empty-child", name: "Техническая", parentId: "parts", productCount: 0, slug: "tehnicheskaya" }),
    ];

    const tree = buildCategoryTree(rows);

    expect(tree.map((node) => node.id)).toEqual(["parts"]);
    expect(tree[0]).toMatchObject({
      children: [{ id: "filters", productCount: 2 }],
      productCount: 2,
    });
  });

  it("hides an entire subtree when an ancestor is inactive", () => {
    const rows: CategoryTreeRow[] = [
      row({ id: "parts", isActive: false, name: "Запчасти", slug: "zapchasti" }),
      row({ id: "body", name: "Кузов", parentId: "parts", slug: "kuzov" }),
      row({ id: "wipers", name: "Щётки", parentId: "body", slug: "shchetki" }),
      row({ id: "oils", name: "Масла", slug: "masla" }),
    ];

    const tree = buildCategoryTree(rows);

    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ id: "oils" });
  });

  it("hides a node whose parent is missing from the row set (soft-deleted)", () => {
    const rows: CategoryTreeRow[] = [
      row({ id: "body", name: "Кузов", parentId: "deleted-parent", slug: "kuzov" }),
      row({ id: "oils", name: "Масла", slug: "masla" }),
    ];

    const tree = buildCategoryTree(rows);

    expect(tree.map((node) => node.id)).toEqual(["oils"]);
  });

  it("treats a cyclic chain that never reaches a root as invisible", () => {
    const rows: CategoryTreeRow[] = [
      row({ id: "a", name: "A", parentId: "b", slug: "a" }),
      row({ id: "b", name: "B", parentId: "a", slug: "b" }),
      row({ id: "oils", name: "Масла", slug: "masla" }),
    ];

    const tree = buildCategoryTree(rows);

    expect(tree.map((node) => node.id)).toEqual(["oils"]);
  });

  it("orders siblings by sortOrder then localized name", () => {
    const rows: CategoryTreeRow[] = [
      row({ id: "b", name: "Бамперы", slug: "bampery", sortOrder: 5 }),
      row({ id: "a", name: "Аккумуляторы", slug: "akkumulyatory", sortOrder: 1 }),
      row({ id: "c", name: "Ёмкости", slug: "emkosti", sortOrder: 1 }),
    ];

    const tree = buildCategoryTree(rows);

    expect(tree.map((node) => node.id)).toEqual(["a", "c", "b"]);
  });
});

describe("resolveCategoryPath", () => {
  const tree = buildCategoryTree([
    row({ id: "parts", name: "Запчасти", slug: "zapchasti" }),
    row({ id: "body", name: "Кузов", parentId: "parts", slug: "kuzov" }),
    row({ id: "wipers", name: "Щётки", parentId: "body", slug: "shchetki" }),
    row({ id: "oils", name: "Масла", slug: "masla" }),
  ]);

  it("resolves a deep path with its full ancestor chain in order", () => {
    const location = resolveCategoryPath(tree, ["zapchasti", "kuzov", "shchetki"]);

    expect(location?.node).toMatchObject({ id: "wipers" });
    expect(location?.ancestors.map((node) => node.id)).toEqual(["parts", "body"]);
  });

  it("resolves a top-level path with no ancestors", () => {
    const location = resolveCategoryPath(tree, ["zapchasti"]);

    expect(location?.node).toMatchObject({ id: "parts" });
    expect(location?.ancestors).toEqual([]);
  });

  it("returns null when a segment does not match", () => {
    expect(resolveCategoryPath(tree, ["zapchasti", "does-not-exist"])).toBeNull();
    expect(resolveCategoryPath(tree, ["masla", "kuzov"])).toBeNull();
  });

  it("returns null for an empty path", () => {
    expect(resolveCategoryPath(tree, [])).toBeNull();
  });
});
