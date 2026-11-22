import { Injectable, Logger } from "@nestjs/common";

import { DatabaseService } from "../infrastructure/database.service.js";
import { PartsFinderError } from "./engine/errors.js";
import { decideProductLink, UNLINKABLE_SECTIONS, type BrandIdentities } from "./parts-finder-assortment.logic.js";
import { PartsFinderCrossStore } from "./parts-finder-crosses.store.js";
import { PartsFinderEngine } from "./parts-finder.engine.js";

export interface AssortmentLinkReport {
  brandMismatch: number;
  creditsUsed: number;
  crossesStored: number;
  error: string | null;
  finishedAt: string;
  linked: number;
  noData: number;
}

interface Candidate { brand: string; id: string; sku: string }

const BATCH = 40;
const PAUSE_MS = 350;
/** A number the catalogue did not know is asked again after this long. */
const RECHECK_DAYS = 180;

/**
 * Links our own assortment to the parts catalogue ahead of time, so that a
 * customer's number — an original (OE) number, another brand's analog, or an
 * article from a car's part list — reaches the product on our shelf without
 * any lookup at request time (docs/CATALOG_MATCHING.md).
 *
 * For every product with a brand and an article: one FAPI card (1 credit,
 * cached; a second credit when several brands share the number). The card is
 * used only when its brand is our brand; its original numbers, replacements
 * and analogs go to app.article_crosses. What was looked up is remembered in
 * app.parts_finder_product_links, so a run continues where the last stopped
 * and never pays twice. Goods in stock go first; fluids, chemistry and tools
 * have no part-number catalogue and are skipped.
 */
@Injectable()
export class PartsFinderAssortmentService {
  private readonly logger = new Logger(PartsFinderAssortmentService.name);
  private running: Promise<AssortmentLinkReport> | null = null;
  private last: AssortmentLinkReport | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly engine: PartsFinderEngine,
    private readonly crossStore: PartsFinderCrossStore,
  ) {}

  async status() {
    const result = await this.database.query<{
      brand_mismatch: string; confirmed: string; linkable: string; linked: string; no_data: string; possible: string; products: string; review: string;
    }>(
      `WITH own AS (
         SELECT product.id,product.sku_normalized,brand.name AS brand,COALESCE(parent.slug,category.slug)::text AS section
         FROM app.products AS product
         LEFT JOIN app.brands AS brand ON brand.id=product.brand_id
         LEFT JOIN app.categories AS category ON category.id=product.category_id
         LEFT JOIN app.categories AS parent ON parent.id=category.parent_id
         WHERE product.is_active AND product.deleted_at IS NULL
       )
       SELECT (SELECT count(*) FROM own)::text AS products,
              (SELECT count(*) FROM own WHERE sku_normalized<>'' AND brand IS NOT NULL AND (section IS NULL OR NOT section=ANY($1::text[])))::text AS linkable,
              (SELECT count(*) FROM app.parts_finder_product_links AS link JOIN own ON own.id=link.product_id WHERE link.status='linked')::text AS linked,
              (SELECT count(*) FROM app.parts_finder_product_links AS link JOIN own ON own.id=link.product_id WHERE link.status='no_data')::text AS no_data,
              (SELECT count(*) FROM app.parts_finder_product_links AS link JOIN own ON own.id=link.product_id WHERE link.status='brand_mismatch')::text AS brand_mismatch,
              (SELECT count(*) FROM app.article_crosses WHERE status='confirmed')::text AS confirmed,
              (SELECT count(*) FROM app.article_crosses WHERE status='unconfirmed')::text AS possible,
              (SELECT count(*) FROM app.article_crosses AS pair WHERE pair.status='unconfirmed' AND EXISTS (
                 SELECT 1 FROM own WHERE own.sku_normalized IN (pair.article_a,pair.article_b)))::text AS review`,
      [[...UNLINKABLE_SECTIONS]],
    );
    const row = result.rows[0]!;
    const linkable = Number(row.linkable);
    const checked = Number(row.linked) + Number(row.no_data) + Number(row.brand_mismatch);
    return {
      brandMismatch: Number(row.brand_mismatch),
      crosses: { confirmed: Number(row.confirmed), possible: Number(row.possible), reviewForOurProducts: Number(row.review) },
      fapiConfigured: Boolean(this.engine.fapiKey),
      lastRun: this.last,
      linkable,
      linked: Number(row.linked),
      noData: Number(row.no_data),
      pending: Math.max(0, linkable - checked),
      products: Number(row.products),
      running: this.running !== null,
    };
  }

  /** Starts one background run; `maxCredits` caps what it may spend. */
  start(maxCredits: number): { started: boolean } {
    if (this.running || !this.engine.fapiKey) return { started: false };
    this.running = this.link(maxCredits)
      .catch((error: unknown): AssortmentLinkReport => {
        this.logger.warn(`assortment linking failed: ${error instanceof Error ? error.message : "unknown"}`);
        return { brandMismatch: 0, creditsUsed: 0, crossesStored: 0, error: "Связывание прервалось. Повторите позже.", finishedAt: new Date().toISOString(), linked: 0, noData: 0 };
      })
      .then((report) => { this.last = report; return report; })
      .finally(() => { this.running = null; });
    return { started: true };
  }

  /** One run, awaited (CLI and tests). */
  async link(maxCredits: number): Promise<AssortmentLinkReport> {
    const report: AssortmentLinkReport = { brandMismatch: 0, creditsUsed: 0, crossesStored: 0, error: null, finishedAt: "", linked: 0, noData: 0 };
    const startUsed = await this.spentToday();
    const identities = await this.brandIdentities();
    const attempted: string[] = [];
    run: for (;;) {
      const batch = await this.candidates(attempted);
      if (batch.length === 0) break;
      for (const product of batch) {
        attempted.push(product.id);
        report.creditsUsed = await this.spentToday() - startUsed;
        // A product may need two credits: stop while both still fit.
        if (report.creditsUsed + 2 > maxCredits) break run;
        try {
          await this.linkProduct(product, identities, report);
        } catch (error) {
          if (error instanceof PartsFinderError && [401, 402, 403, 429].includes(error.status)) {
            report.error = error.message;
            break run;
          }
          // A malformed answer for one number: leave the product for a later run.
        }
        await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
      }
    }
    report.creditsUsed = await this.spentToday() - startUsed;
    report.finishedAt = new Date().toISOString();
    return report;
  }

  private async linkProduct(product: Candidate, identities: BrandIdentities, report: AssortmentLinkReport): Promise<void> {
    let card = await this.engine.crosses({ article: product.sku });
    let decision = decideProductLink(card, product.brand, identities);
    if (decision.action === "ask_brand") {
      card = await this.engine.crosses({ article: product.sku, manufacturer_id: decision.manufacturerId });
      decision = decideProductLink(card, product.brand, identities);
      if (decision.action === "ask_brand") decision = { action: "no_data" };
    }
    let crosses = 0;
    if (decision.action === "linked") {
      crosses = await this.crossStore.remember(card);
      report.linked += 1;
      report.crossesStored += crosses;
    } else if (decision.action === "brand_mismatch") report.brandMismatch += 1;
    else report.noData += 1;
    await this.database.query(
      `INSERT INTO app.parts_finder_product_links (product_id,status,crosses,note) VALUES ($1,$2,$3,$4)
       ON CONFLICT (product_id) DO UPDATE SET status=EXCLUDED.status,crosses=EXCLUDED.crosses,note=EXCLUDED.note,checked_at=clock_timestamp()`,
      [product.id, decision.action, crosses, decision.action === "brand_mismatch" ? decision.note : null],
    );
  }

  private async candidates(attempted: readonly string[]): Promise<Candidate[]> {
    const result = await this.database.query<Candidate>(
      `SELECT product.id,product.sku::text AS sku,brand.name AS brand
       FROM app.products AS product
       JOIN app.brands AS brand ON brand.id=product.brand_id AND brand.is_active AND brand.deleted_at IS NULL
       LEFT JOIN app.categories AS category ON category.id=product.category_id
       LEFT JOIN app.categories AS parent ON parent.id=category.parent_id
       LEFT JOIN app.parts_finder_product_links AS link ON link.product_id=product.id
       LEFT JOIN LATERAL (
         SELECT COALESCE(sum(balance.quantity_on_hand-balance.quantity_reserved),0) AS available
         FROM app.inventory_balances AS balance WHERE balance.product_id=product.id
       ) AS stock ON true
       WHERE product.is_active AND product.deleted_at IS NULL AND product.sku_normalized<>''
         AND length(product.sku_normalized)>=4
         AND (COALESCE(parent.slug,category.slug) IS NULL OR NOT COALESCE(parent.slug,category.slug)::text=ANY($1::text[]))
         AND (link.product_id IS NULL OR (link.status='no_data' AND link.checked_at<clock_timestamp()-make_interval(days => $2)))
         AND NOT product.id=ANY($3::uuid[])
       ORDER BY (stock.available>0) DESC,product.updated_at DESC,product.id
       LIMIT $4`,
      [[...UNLINKABLE_SECTIONS], RECHECK_DAYS, [...attempted], BATCH],
    );
    return result.rows;
  }

  private async brandIdentities(): Promise<BrandIdentities> {
    const result = await this.database.query<{ alias: string; canonical: string }>("SELECT alias,canonical FROM app.brand_identities");
    return new Map(result.rows.map((row) => [row.alias, row.canonical]));
  }

  private async spentToday(): Promise<number> {
    return (await this.engine.ledger.summary(this.engine.today())).reservedToday;
  }
}
