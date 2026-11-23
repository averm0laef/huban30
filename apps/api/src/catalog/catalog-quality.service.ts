import { BadRequestException, Injectable } from "@nestjs/common";
import { publicProductName } from "@an30/contracts";
import { z } from "zod";

import { DatabaseService } from "../infrastructure/database.service.js";
import { UNCATEGORIZED_CATEGORY_SLUG } from "./catalog-known-categories.js";

/**
 * «Качество каталога» (docs/OWN_CATALOG.md): one list per thing to fix in 1С, what is in stock first, with the code
 * to find the item by in 1С and a table Excel opens. Only reads.
 */
export const QUALITY_CHECKS = ["no_brand", "no_sku", "shared_number", "duplicate_name", "service_name", "uncategorized", "no_photo", "no_price"] as const;
export type QualityCheck = (typeof QUALITY_CHECKS)[number];

/** What the staff do in 1С about each problem: the last column of the table. */
export const QUALITY_ACTIONS: Record<QualityCheck, string> = {
  duplicate_name: "Объединить карточки в 1С или различить названия",
  no_brand: "Заполнить «Производитель» в карточке 1С",
  no_photo: "Снять на телефон в «Фото товаров» или прикрепить фото в 1С (сначала то, что в наличии)",
  no_price: "Проверить вид цен «Оптовая цена» в 1С",
  no_sku: "Заполнить «Артикул» (номер детали) в 1С",
  service_name: "Убрать пометку из названия (в «Описание») или скрыть товар",
  shared_number: "Проверить артикул: тот же номер у товара другого раздела",
  uncategorized: "Указать группу в 1С или правило раздела в настройках сайта",
};

/** A 1С code standing for the article: the list export and an exchange without «Артикул» give it («00-00009366»). */
const CODE_FOR_ARTICLE = String.raw`^\d{2}-\d{8}$`;

const CONDITIONS: Record<QualityCheck, string> = {
  duplicate_name: "lower(regexp_replace(product.name,'\\s+',' ','g')) IN (SELECT name_key FROM duplicate_names)",
  no_brand: "product.brand_id IS NULL",
  no_photo: "NOT EXISTS (SELECT 1 FROM app.product_images AS image WHERE image.product_id=product.id)",
  no_price: "(price.amount_kopeks IS NULL OR price.amount_kopeks=0)",
  no_sku: `(product.sku_normalized='' OR product.sku::text=product.external_id OR product.sku::text ~ '${CODE_FOR_ARTICLE}')`,
  service_name: "product.name ~* '(^|[^а-яёa-z])(аудит|коробка\\s*\\d)'",
  shared_number: "product.sku_normalized IN (SELECT number FROM shared_numbers)",
  uncategorized: `category.slug='${UNCATEGORIZED_CATEGORY_SLUG}'`,
};

const BASE = `WITH RECURSIVE tree AS (
  SELECT id,slug::text AS root FROM app.categories WHERE parent_id IS NULL
  UNION ALL SELECT child.id,tree.root FROM app.categories AS child JOIN tree ON child.parent_id=tree.id
), live AS (
  SELECT product.id,product.sku_normalized,product.name,tree.root FROM app.products AS product
  LEFT JOIN tree ON tree.id=product.category_id
  WHERE product.deleted_at IS NULL AND NOT product.is_demo
), shared_numbers AS (
  -- A number on products of two sections, or of a section and the queue: at least one of them is likely wrong.
  SELECT sku_normalized AS number FROM live WHERE sku_normalized<>'' GROUP BY sku_normalized
  HAVING count(DISTINCT COALESCE(root,''))>1 OR bool_or(root IS NULL OR root='${UNCATEGORIZED_CATEGORY_SLUG}') AND count(*)>1
), duplicate_names AS (
  SELECT lower(regexp_replace(name,'\\s+',' ','g')) AS name_key FROM live GROUP BY 1 HAVING count(*)>1
), product_rows AS (
  SELECT product.id,product.external_id,product.sku::text AS sku,product.name,brand.name AS brand,
         category.name AS category,category.slug::text AS category_slug,product.sku_normalized,product.external_id AS code,
         price.amount_kopeks,GREATEST(COALESCE(stock.available,0),0) AS available,product.brand_id,
         ${QUALITY_CHECKS.map((check) => `(${CONDITIONS[check]}) AS ${check}`).join(",\n         ")}
  FROM app.products AS product
  LEFT JOIN app.brands AS brand ON brand.id=product.brand_id
  LEFT JOIN app.categories AS category ON category.id=product.category_id
  LEFT JOIN app.current_product_prices AS price ON price.product_id=product.id AND price.currency='RUB'
  LEFT JOIN LATERAL (
    SELECT sum(balance.quantity_on_hand-balance.quantity_reserved)::bigint AS available
    FROM app.inventory_balances AS balance WHERE balance.product_id=product.id
  ) AS stock ON true
  WHERE product.deleted_at IS NULL AND NOT product.is_demo
)`;

const ListQuery = z.object({
  check: z.enum(QUALITY_CHECKS),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

interface QualityRow {
  amount_kopeks: string | null;
  available: string;
  brand: string | null;
  category: string | null;
  code: string | null;
  id: string;
  name: string;
  sku: string;
  total: string;
}

/** One cell of the table: quoted when it must be, and never a formula when Excel opens it. */
function cell(value: string | number | null): string {
  if (value === null) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/u.test(text)) text = `'${text}`;
  return /[;"\r\n\s]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

@Injectable()
export class CatalogQualityService {
  constructor(private readonly database: DatabaseService) {}

  /** How many products each check finds. */
  async summary(): Promise<Record<QualityCheck, number>> {
    const row = (await this.database.query<Record<QualityCheck, string>>(
      `${BASE} SELECT ${QUALITY_CHECKS.map((check) => `count(*) FILTER (WHERE ${check})::text AS ${check}`).join(",")} FROM product_rows`,
    )).rows[0];
    return Object.fromEntries(QUALITY_CHECKS.map((check) => [check, Number(row?.[check] ?? 0)])) as Record<QualityCheck, number>;
  }

  async list(rawQuery: unknown) {
    const parsed = ListQuery.safeParse(rawQuery ?? {});
    if (!parsed.success) throw new BadRequestException({ error: "invalid_quality_query", issues: parsed.error.issues });
    const { check, limit, offset } = parsed.data;
    const rows = await this.rows(check, limit, offset);
    return {
      action: QUALITY_ACTIONS[check],
      check,
      items: rows.map((row) => ({
        availableQuantity: Number(row.available),
        brand: row.brand,
        category: row.category,
        code: row.code,
        id: row.id,
        name: row.name,
        priceKopeks: row.amount_kopeks === null ? null : Number(row.amount_kopeks),
        shownName: publicProductName(row.name, row.sku),
        sku: row.sku,
      })),
      limit,
      offset,
      total: Number(rows[0]?.total ?? 0),
    };
  }

  /** The whole list as a table for 1С (UTF-8 with a BOM, «;» between cells: what Excel in Russia opens as is). */
  async csv(rawCheck: unknown): Promise<string> {
    const check = ListQuery.shape.check.safeParse(rawCheck);
    if (!check.success) throw new BadRequestException({ error: "invalid_quality_query" });
    const rows = await this.rows(check.data, 50_000, 0);
    const lines = [["Код 1С", "Артикул", "Название", "Бренд", "Раздел", "Остаток", "Цена, ₽", "Что сделать"].join(";")];
    for (const row of rows) {
      lines.push([
        row.code, row.sku, row.name, row.brand, row.category, Number(row.available),
        row.amount_kopeks === null ? null : (Number(row.amount_kopeks) / 100).toFixed(2).replace(".", ","), QUALITY_ACTIONS[check.data],
      ].map(cell).join(";"));
    }
    return `\uFEFF${lines.join("\r\n")}\r\n`;
  }

  private async rows(check: QualityCheck, limit: number, offset: number): Promise<QualityRow[]> {
    return (await this.database.query<QualityRow>(
      `${BASE}
       SELECT id,code,sku,name,brand,category,amount_kopeks::text,available::text,count(*) OVER ()::text AS total
       FROM product_rows WHERE ${check}
       ORDER BY (available>0) DESC,available DESC,lower(name) COLLATE app.russian_names,id
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    )).rows;
  }
}
