import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";

import type { AuthContext } from "../auth/auth-context.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { AuditService } from "../security/audit.service.js";

export const CrossReviewDecisionSchema = z.object({ decision: z.enum(["confirm", "reject"]) }).strict();
export const CrossReviewQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

interface ReviewRow {
  article_a_raw: string; article_b_raw: string; brand_a_raw: string; brand_b_raw: string; evidence: string[]; id: string;
  last_seen_at: Date; product_name: string; product_sku: string; product_slug: string; relation: string | null; total: string;
}

/**
 * Staff review of presumptive pairs that touch our own products: these are
 * the «возможный аналог» rows a customer sees. One click turns a pair into a
 * confirmed analog or removes it for good (docs/CATALOG_MATCHING.md).
 */
@Injectable()
export class PartsFinderCrossReviewService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(query: unknown) {
    const parsed = CrossReviewQuerySchema.safeParse(query ?? {});
    if (!parsed.success) throw new BadRequestException("Проверьте параметры списка");
    const { limit, offset } = parsed.data;
    const result = await this.database.query<ReviewRow>(
      `SELECT pair.id,pair.article_a_raw,pair.brand_a_raw,pair.article_b_raw,pair.brand_b_raw,pair.evidence,pair.relation,pair.last_seen_at,
              product.name AS product_name,product.sku::text AS product_sku,product.slug::text AS product_slug,count(*) OVER()::text AS total
       FROM app.article_crosses AS pair
       JOIN LATERAL (
         SELECT own.name,own.sku,own.slug FROM app.products AS own
         LEFT JOIN app.brands AS brand ON brand.id=own.brand_id
         WHERE own.is_active AND own.deleted_at IS NULL AND own.sku_normalized<>''
           AND ((own.sku_normalized=pair.article_a AND app.canonical_brand(brand.name)=app.canonical_brand(pair.brand_a))
             OR (own.sku_normalized=pair.article_b AND app.canonical_brand(brand.name)=app.canonical_brand(pair.brand_b)))
         ORDER BY own.name LIMIT 1
       ) AS product ON true
       WHERE pair.status='unconfirmed'
       ORDER BY pair.last_seen_at DESC,pair.id
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        lastSeenAt: row.last_seen_at.toISOString(),
        ours: { name: row.product_name, sku: row.product_sku, slug: row.product_slug },
        partA: { article: row.article_a_raw, brand: row.brand_a_raw },
        partB: { article: row.article_b_raw, brand: row.brand_b_raw },
        relation: row.relation,
        sources: row.evidence,
      })),
      limit,
      offset,
      total: Number(result.rows[0]?.total ?? 0),
    };
  }

  async decide(id: string, body: unknown, actor: AuthContext) {
    const parsed = CrossReviewDecisionSchema.safeParse(body ?? {});
    if (!parsed.success || !z.uuid().safeParse(id).success) throw new BadRequestException("Выберите решение: подтвердить или отклонить");
    const confirm = parsed.data.decision === "confirm";
    return this.database.transaction(async (client) => {
      const updated = await client.query<{ article_a_raw: string; article_b_raw: string; brand_a_raw: string; brand_b_raw: string }>(
        `UPDATE app.article_crosses SET
           status=$2,
           confirmed_at=CASE WHEN $2='confirmed' THEN clock_timestamp() END,
           confirmed_by=CASE WHEN $2='confirmed' THEN $3::uuid END,
           rejected_by=CASE WHEN $2='rejected' THEN $3::uuid END
         WHERE id=$1 AND status='unconfirmed'
         RETURNING article_a_raw,brand_a_raw,article_b_raw,brand_b_raw`,
        [id, confirm ? "confirmed" : "rejected", actor.userId],
      );
      const row = updated.rows[0];
      if (!row) throw new NotFoundException("Пара уже разобрана или не найдена");
      await this.audit.record({
        action: confirm ? "article_cross.confirmed" : "article_cross.rejected",
        actorRole: actor.role,
        actorUserId: actor.userId,
        afterState: { partA: `${row.brand_a_raw} ${row.article_a_raw}`, partB: `${row.brand_b_raw} ${row.article_b_raw}`, status: confirm ? "confirmed" : "rejected" },
        entityId: id,
        entityType: "article_cross",
      }, client);
      return { id, status: confirm ? "confirmed" as const : "rejected" as const };
    });
  }
}
