// Product documents for the optional search engine, read from PostgreSQL
// (the source of truth). Only products the public catalog shows are
// indexed -- active, not deleted, brand active, category chain active --
// the same rules as apps/api/src/catalog/catalog-visibility.sql.ts. The API
// re-checks visibility when it reads the rows, so a stale document can at
// worst be skipped, never shown.

export interface ProductDocumentRow {
  available_quantity: string;
  brand_key: string | null;
  brand_name: string | null;
  brand_slug: string | null;
  category_path: string[] | null;
  created_at: Date;
  id: string;
  name_folded: string;
  price_kopeks: string | null;
  sku: string;
  sku_normalized: string | null;
}

export interface ProductDocument {
  available_quantity: number;
  brand: string | null;
  brand_key: string | null;
  brand_slug: string | null;
  category_path: string[];
  created_at: string;
  id: string;
  in_stock: boolean;
  lead: string;
  measures: string[];
  name: string;
  name_sort: string;
  price_kopeks: number | null;
  sku: string;
  sku_normalized: string;
}

interface Queryable {
  query<Row>(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}

const DOCUMENT_SELECT = `WITH RECURSIVE category_ancestry AS (
  SELECT category.id AS origin_id,category.id AS current_id,category.parent_id,
         category.is_active,category.deleted_at,ARRAY[category.id]::uuid[] AS path
  FROM app.categories AS category
  UNION ALL
  SELECT ancestry.origin_id,parent.id,parent.parent_id,parent.is_active,parent.deleted_at,
         ancestry.path || parent.id
  FROM category_ancestry AS ancestry
  JOIN app.categories AS parent ON parent.id=ancestry.parent_id
  WHERE NOT parent.id=ANY(ancestry.path)
), visible_categories AS (
  SELECT origin_id AS id, array_agg(ancestor.slug::text) AS category_path
  FROM category_ancestry
  JOIN app.categories AS ancestor ON ancestor.id=category_ancestry.current_id
  GROUP BY origin_id
  HAVING bool_and(category_ancestry.is_active AND category_ancestry.deleted_at IS NULL)
     AND bool_or(category_ancestry.parent_id IS NULL)
)
SELECT product.id,product.sku::text,product.sku_normalized,product.name_folded,product.created_at,
       brand.name AS brand_name,brand.slug::text AS brand_slug,
       CASE WHEN brand.id IS NULL THEN NULL ELSE app.normalize_brand(brand.name) END AS brand_key,
       visible_categories.category_path,price.amount_kopeks::text AS price_kopeks,
       stock.available_quantity::text
FROM app.products AS product
LEFT JOIN app.brands AS brand ON brand.id=product.brand_id
LEFT JOIN visible_categories ON visible_categories.id=product.category_id
LEFT JOIN app.current_product_prices AS price ON price.product_id=product.id AND price.currency='RUB'
LEFT JOIN LATERAL (
  SELECT COALESCE(sum(balance.quantity_on_hand-balance.quantity_reserved),0)::bigint AS available_quantity
  FROM app.inventory_balances AS balance
  JOIN app.warehouses AS warehouse ON warehouse.id=balance.warehouse_id
  WHERE balance.product_id=product.id AND warehouse.is_active AND warehouse.deleted_at IS NULL
) AS stock ON true
WHERE product.is_active AND product.deleted_at IS NULL
  AND (product.brand_id IS NULL OR (brand.is_active AND brand.deleted_at IS NULL))
  AND (product.category_id IS NULL OR visible_categories.id IS NOT NULL)`;

/** Visible products among `ids`; ids missing from the result must be removed from the index. */
export async function loadProductDocuments(database: Queryable, ids: string[]): Promise<ProductDocument[]> {
  if (ids.length === 0) return [];
  const result = await database.query<ProductDocumentRow>(`${DOCUMENT_SELECT}
  AND product.id=ANY($1::uuid[])`, [ids]);
  return result.rows.map(productDocument);
}

/** One page of every visible product, by id, for a full reindex. */
export async function loadProductDocumentPage(database: Queryable, after: string | null, limit: number): Promise<ProductDocument[]> {
  const result = await database.query<ProductDocumentRow>(`${DOCUMENT_SELECT}
  AND ($1::uuid IS NULL OR product.id>$1::uuid)
ORDER BY product.id LIMIT $2`, [after, limit]);
  return result.rows.map(productDocument);
}

export function productDocument(row: ProductDocumentRow): ProductDocument {
  const name = row.name_folded;
  const available = Number(row.available_quantity);
  return {
    available_quantity: Number.isSafeInteger(available) ? Math.max(0, available) : 0,
    brand: row.brand_name,
    brand_key: row.brand_key,
    brand_slug: row.brand_slug,
    category_path: row.category_path ?? [],
    created_at: row.created_at.toISOString(),
    id: row.id,
    in_stock: available > 0,
    lead: name.trim().split(/\s+/u)[0]?.toLowerCase() ?? "",
    measures: measureKeys(name),
    name,
    name_sort: name.toLowerCase(),
    price_kopeks: row.price_kopeks === null ? null : Number(row.price_kopeks),
    sku: row.sku,
    sku_normalized: (row.sku_normalized ?? "").toLowerCase(),
  };
}

// Same canonical units as UNITS in apps/api/src/catalog/catalog-search-tokens.ts
// (the query side). Keep both lists in sync.
const UNIT_SPELLINGS: ReadonlyArray<readonly [string, string]> = [
  ["литров", "л"], ["литра", "л"], ["литр", "л"], ["ltr", "л"], ["lt", "л"], ["мл", "мл"], ["ml", "мл"],
  ["л", "л"], ["l", "л"], ["кг", "кг"], ["kg", "кг"], ["мм", "мм"], ["mm", "мм"],
  ["а/ч", "ач"], ["a/h", "ач"], ["ач", "ач"], ["ah", "ач"], ["ватт", "вт"], ["вт", "вт"], ["w", "вт"],
  ["вольт", "в"], ["в", "в"], ["v", "в"], ["ампер", "а"], ["а", "а"], ["a", "а"],
];
const UNIT_ALTERNATION = UNIT_SPELLINGS.map(([spelling]) => spelling.replace("/", "\\/")).join("|");
const UNIT_BY_SPELLING = new Map(UNIT_SPELLINGS);

/** Canonical measurement keys found in a product name ("Масло 5W-40 4 л" -> visc:5w40, 4л, num:4 ...). */
export function measureKeys(text: string): string[] {
  const value = text.toLowerCase().replace(/ё/gu, "е");
  const keys = new Set<string>();
  for (const match of value.matchAll(/(^|[^0-9a-zа-я])(\d{1,2})\s?[wв]\s?-?\s?(\d{2})(?![0-9])/gu)) {
    keys.add(`visc:${Number(match[2])}w${match[3]}`);
  }
  const withUnit = new RegExp(`(^|[^0-9.,])(\\d+(?:[.,]\\d+)?((?:/\\d+(?:[.,]\\d+)?)*))\\s?(${UNIT_ALTERNATION})(?![a-zа-я0-9]|-\\d)`, "gu");
  for (const match of value.matchAll(withUnit)) {
    const unit = UNIT_BY_SPELLING.get(match[4]!)!;
    for (const amount of match[2]!.split("/")) keys.add(`${amount.replace(",", ".")}${unit}`);
  }
  for (const match of value.matchAll(/(^|[^0-9.,])(\d{1,3})(?![0-9])/gu)) keys.add(`num:${Number(match[2])}`);
  return [...keys];
}
