import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadMigrations } from "./migrations.js";

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

describe("catalog search ё-fold and word-form migration", () => {
  it("adds an IMMUTABLE fold function and folded, generated, indexed columns -- the backfill for existing rows", async () => {
    const migration = (await loadMigrations(directory)).find(
      ({ id }) => id === "0025_catalog_search_yo_and_word_forms",
    );
    expect(migration).toBeDefined();
    const sql = migration?.sql ?? "";

    // app.fold_yo mirrors app.normalize_article (migration 0016): IMMUTABLE
    // so it is usable inside a generated column.
    expect(sql).toContain("CREATE FUNCTION app.fold_yo(value text)");
    expect(sql).toContain("IMMUTABLE");
    expect(sql).toContain("replace(replace(coalesce(value, ''), 'ё', 'е'), 'Ё', 'Е')");

    // Both generated columns exist -- name_folded backs the ILIKE/trigram
    // branches (name only), search_text_folded backs the full-text branches
    // (search_text, which already folds in sku -- falls back to name).
    expect(sql).toContain(
      "ADD COLUMN name_folded text GENERATED ALWAYS AS (app.fold_yo(name)) STORED",
    );
    expect(sql).toContain(
      "ADD COLUMN search_text_folded text GENERATED ALWAYS AS (app.fold_yo(coalesce(search_text, name))) STORED",
    );

    // GENERATED ALWAYS AS ... STORED computes the value for every existing
    // row as part of ADD COLUMN -- this *is* the backfill a change to
    // indexed text needs, not a separate UPDATE statement.
    expect(sql).not.toContain("UPDATE app.products");

    // Both folded columns are actually indexed -- ILIKE/trigram similarity
    // on name_folded, and 'simple' *and* 'russian' full-text on
    // search_text_folded (see the second test below for the word-forms
    // half of this migration).
    expect(sql).toContain("CREATE INDEX products_name_folded_trgm_idx ON app.products USING gin (name_folded gin_trgm_ops)");
    expect(sql).toContain(
      "CREATE INDEX products_search_folded_simple_idx ON app.products USING gin (to_tsvector('simple', search_text_folded))",
    );
    expect(sql).toContain(
      "CREATE INDEX products_search_folded_russian_idx ON app.products USING gin (to_tsvector('russian', search_text_folded))",
    );
  });

  it("documents the word-form gap it does and does not close", async () => {
    const migration = (await loadMigrations(directory)).find(
      ({ id }) => id === "0025_catalog_search_yo_and_word_forms",
    );
    const sql = migration?.sql ?? "";

    // Real stemming (PostgreSQL's built-in 'russian' config), not a
    // hand-rolled prefix heuristic and not a large external morphology
    // dependency -- see the migration's own comment for the reasoning.
    expect(sql).toContain("'russian'");
    // Explicitly documents the case it deliberately does not match --
    // "щёток" has no suffix for a stemmer to strip (epenthetic vowel), so
    // this is called out rather than silently left as a gap. See
    // catalog-public.service.test.ts for the corresponding TypeScript-side
    // documentation of the same gap.
    expect(sql).toContain("щёток");
    expect(sql).toContain("epenthetic");
  });
});
