import { Injectable, Logger } from "@nestjs/common";

import { DatabaseService } from "../infrastructure/database.service.js";

export interface CrossRow {
  article: string;
  brand: string;
  crossArticle: string;
  crossBrand: string;
  confirmed: boolean;
}

export type CrossSource = "fapi" | "rossko";

/** Groups of a FAPI part card that name the same part: never a guess. */
const TRUSTED_GROUPS = new Set(["oe", "replaced_by", "replaces"]);
const MAX_ROWS_PER_CARD = 400;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Pairs a FAPI part card (findPart result) yields for app.article_crosses:
 * the part against every oe / analog / replacement. Manufacturer numbers,
 * replacements and analogs the manufacturer verified arrive confirmed.
 */
export function crossRowsFromCard(card: Record<string, unknown>): CrossRow[] {
  const part = card.current && typeof card.current === "object" ? card.current : card.part;
  if (!part || typeof part !== "object") return [];
  const article = text((part as Record<string, unknown>).article);
  const brand = text((part as Record<string, unknown>).brand);
  if (!article || !brand) return [];
  const groups = card.groups && typeof card.groups === "object" ? card.groups as Record<string, unknown> : {};
  const rows: CrossRow[] = [];
  for (const [group, list] of Object.entries(groups)) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const crossArticle = text(record.article);
      const crossBrand = text(record.brand);
      if (!crossArticle || !crossBrand) continue;
      rows.push({ article, brand, confirmed: TRUSTED_GROUPS.has(group) || record.manufacturer_verified === true, crossArticle, crossBrand });
    }
  }
  return rows.slice(0, MAX_ROWS_PER_CARD);
}

interface SupplierPartLike { brand: string; crosses?: readonly SupplierPartLike[]; partNumber: string }

/**
 * Pairs a supplier search asserts: every found part against its own analogs.
 * One source's word — stored unconfirmed until FAPI or staff agree.
 */
export function crossRowsFromSupplier(parts: readonly SupplierPartLike[]): CrossRow[] {
  const rows: CrossRow[] = [];
  for (const part of parts) {
    const article = text(part.partNumber);
    const brand = text(part.brand);
    if (!article || !brand) continue;
    for (const cross of part.crosses ?? []) {
      const crossArticle = text(cross.partNumber);
      const crossBrand = text(cross.brand);
      if (crossArticle && crossBrand) rows.push({ article, brand, confirmed: false, crossArticle, crossBrand });
    }
  }
  return rows.slice(0, MAX_ROWS_PER_CARD);
}

/**
 * The shop's cross base grows with every FAPI card: one batched upsert into
 * app.article_crosses (source 'fapi', migrations 0041-0042), normalised and
 * ordered by PostgreSQL itself. A staff decision (confirmed or rejected) is
 * never changed; a pending pair is confirmed by a trusted sighting or by a
 * second source (app.article_cross_merged_status).
 */
@Injectable()
export class PartsFinderCrossStore {
  private readonly logger = new Logger(PartsFinderCrossStore.name);

  constructor(private readonly database: DatabaseService) {}

  remember(card: Record<string, unknown>): Promise<number> {
    return this.rememberPairs(crossRowsFromCard(card), "fapi");
  }

  async rememberPairs(rows: readonly CrossRow[], source: CrossSource): Promise<number> {
    if (rows.length === 0) return 0;
    try {
      const result = await this.database.query(
        `WITH incoming AS (
           SELECT app.normalize_article(row.article) AS a,app.normalize_brand(row.brand) AS ab,
                  app.normalize_article(row.cross_article) AS b,app.normalize_brand(row.cross_brand) AS bb,
                  row.article AS ar,row.brand AS abr,row.cross_article AS br,row.cross_brand AS bbr,row.confirmed
           FROM jsonb_to_recordset($1::jsonb)
             AS row(article text,brand text,cross_article text,cross_brand text,confirmed boolean)
         ), ordered AS (
           SELECT DISTINCT ON (pair_a,pair_ab,pair_b,pair_bb) * FROM (
             SELECT CASE WHEN (a,ab)<(b,bb) THEN a ELSE b END AS pair_a,
                    CASE WHEN (a,ab)<(b,bb) THEN ab ELSE bb END AS pair_ab,
                    CASE WHEN (a,ab)<(b,bb) THEN b ELSE a END AS pair_b,
                    CASE WHEN (a,ab)<(b,bb) THEN bb ELSE ab END AS pair_bb,
                    CASE WHEN (a,ab)<(b,bb) THEN ar ELSE br END AS raw_a,
                    CASE WHEN (a,ab)<(b,bb) THEN abr ELSE bbr END AS raw_ab,
                    CASE WHEN (a,ab)<(b,bb) THEN br ELSE ar END AS raw_b,
                    CASE WHEN (a,ab)<(b,bb) THEN bbr ELSE abr END AS raw_bb,
                    confirmed
             FROM incoming WHERE a<>'' AND b<>'' AND (a,ab)<>(b,bb)
           ) AS pairs ORDER BY pair_a,pair_ab,pair_b,pair_bb,confirmed DESC
         )
         INSERT INTO app.article_crosses
           (article_a,brand_a,article_b,brand_b,article_a_raw,brand_a_raw,article_b_raw,brand_b_raw,source,status,confirmed_at,evidence,relation)
         SELECT pair_a,pair_ab,pair_b,pair_bb,raw_a,raw_ab,raw_b,raw_bb,$2::text,
                CASE WHEN confirmed THEN 'confirmed' ELSE 'unconfirmed' END,CASE WHEN confirmed THEN now() END,ARRAY[$2::text],
                app.article_cross_relation(pair_ab,pair_bb)
         FROM ordered
         ON CONFLICT (article_a,brand_a,article_b,brand_b) DO UPDATE SET
           last_seen_at=now(),
           relation=COALESCE(app.article_crosses.relation,EXCLUDED.relation),
           evidence=CASE WHEN $2::text=ANY(app.article_crosses.evidence) THEN app.article_crosses.evidence ELSE app.article_crosses.evidence || $2::text END,
           status=app.article_cross_merged_status(app.article_crosses.status,app.article_crosses.evidence,app.article_crosses.brand_a,app.article_crosses.brand_b,EXCLUDED.status,$2::text),
           confirmed_at=CASE
             WHEN app.article_crosses.status='unconfirmed' AND app.article_cross_merged_status(app.article_crosses.status,app.article_crosses.evidence,app.article_crosses.brand_a,app.article_crosses.brand_b,EXCLUDED.status,$2::text)='confirmed' THEN now()
             ELSE app.article_crosses.confirmed_at END`,
        [JSON.stringify(rows.map((row) => ({
          article: row.article, brand: row.brand, confirmed: row.confirmed, cross_article: row.crossArticle, cross_brand: row.crossBrand,
        }))), source],
      );
      return result.rowCount ?? 0;
    } catch (error) {
      this.logger.warn(`${source} crosses not stored: ${error instanceof Error ? error.message : "unknown error"}`);
      return 0;
    }
  }
}
