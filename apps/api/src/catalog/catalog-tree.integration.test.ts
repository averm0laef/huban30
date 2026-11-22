// The catalogue tree in the code (packages/contracts storefront-taxonomy.ts) and the tree in the database (the
// rows the migrations seed into app.categories) must be the same tree: a section the code knows and the database
// does not would send its products to «Без категории». Real PostgreSQL only; skipped unless
// CATALOG_SEARCH_DATABASE_URL points at a migrated scratch database.

import type { ConfigService } from "@nestjs/config";
import { STOREFRONT_TAXONOMY } from "@an30/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../infrastructure/database.service.js";

const url = process.env.CATALOG_SEARCH_DATABASE_URL;

describe.skipIf(!url)("the catalogue tree in the database (real PostgreSQL)", () => {
  let database: DatabaseService;
  let rows: Array<{ name: string; parent_slug: string | null; slug: string; sort_order: number }> = [];

  beforeAll(async () => {
    database = new DatabaseService({ get: () => "test", getOrThrow: () => url } as unknown as ConfigService);
    rows = (await database.query<{ name: string; parent_slug: string | null; slug: string; sort_order: number }>(
      `SELECT category.slug::text AS slug, category.name, parent.slug::text AS parent_slug, category.sort_order
       FROM app.categories AS category LEFT JOIN app.categories AS parent ON parent.id = category.parent_id
       WHERE category.external_id IS NULL AND category.deleted_at IS NULL AND category.is_active`,
    )).rows;
  });

  afterAll(async () => {
    await database?.onModuleDestroy?.();
  });

  it("has every section of the code's tree, under the same name", () => {
    const seeded = new Map(rows.filter((row) => row.parent_slug === null).map((row) => [row.slug, row.name]));

    expect(STOREFRONT_TAXONOMY.filter((section) => seeded.get(section.slug) !== section.label).map((section) => section.slug)).toEqual([]);
  });

  it("has every subsection under its section, under the same name", () => {
    const seeded = new Map(rows.map((row) => [row.slug, `${row.parent_slug} / ${row.name}`]));
    const expected = STOREFRONT_TAXONOMY.flatMap((section) => section.children.map((child) => ({ slug: child.slug, where: `${section.slug} / ${child.label}` })));

    expect(expected.filter((child) => seeded.get(child.slug) !== child.where).map((child) => child.slug)).toEqual([]);
  });

  it("shows the sections, and the subsections of each, in the order of the code's tree", () => {
    const order = (list: typeof rows) => [...list].sort((a, b) => a.sort_order - b.sort_order).map((row) => row.slug);
    const known = new Set(STOREFRONT_TAXONOMY.map((section) => section.slug));

    expect(order(rows.filter((row) => row.parent_slug === null && known.has(row.slug)))).toEqual(STOREFRONT_TAXONOMY.map((section) => section.slug));
    for (const section of STOREFRONT_TAXONOMY) {
      expect(order(rows.filter((row) => row.parent_slug === section.slug)), section.slug).toEqual(section.children.map((child) => child.slug));
    }
  });
});
