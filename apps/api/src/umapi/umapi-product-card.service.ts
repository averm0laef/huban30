import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../infrastructure/database.service.js";
import type { UmapiSpec } from "./umapi-normalize.js";

export interface ProductCatalogueCard { article: string; brand: string; photos: string[]; specs: UmapiSpec[]; title: string | null }

/**
 * The maker's photo and characteristics kept for a product after a customer asked for them (migration 0062,
 * owner's decision of 24.11.2026). Written only for the product's own part; read by the catalogue for the small
 * photo of lists and by the product page.
 */
@Injectable()
export class UmapiProductCardService {
  constructor(private readonly database: DatabaseService) {}

  async keep(product: { id: string; sku: string }, part: { article: string; artId: number; brand: string }, card: { photos: string[]; specs: UmapiSpec[]; title: string | null }): Promise<void> {
    if (card.photos.length === 0 && card.specs.length === 0) return;
    await this.database.query(
      `INSERT INTO app.product_catalogue_cards (product_id,product_sku,catalogue_brand,catalogue_article,catalogue_article_id,title,photos,specs)
       VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8::jsonb)
       ON CONFLICT (product_id) DO UPDATE SET product_sku=EXCLUDED.product_sku,catalogue_brand=EXCLUDED.catalogue_brand,
         catalogue_article=EXCLUDED.catalogue_article,catalogue_article_id=EXCLUDED.catalogue_article_id,title=EXCLUDED.title,
         photos=EXCLUDED.photos,specs=EXCLUDED.specs,found_at=clock_timestamp()`,
      [product.id, product.sku, part.brand.slice(0, 80), part.article.slice(0, 64), part.artId, card.title, card.photos.slice(0, 8), JSON.stringify(card.specs.slice(0, 30))],
    );
  }
}
