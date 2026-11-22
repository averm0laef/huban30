import { Injectable, Logger } from "@nestjs/common";

import { searchLogQuery } from "../dashboard/dashboard-logic.js";
import { DatabaseService } from "../infrastructure/database.service.js";

/**
 * Remembers what customers searched for and how many products came back,
 * for the staff dashboard («Интенсивность поиска», «Ищут, но не находят»).
 * Only the first page of a search is counted, the text is cleaned by
 * searchLogQuery (no phones, e-mails or full VINs) and writing never slows
 * down or breaks the search itself.
 */
@Injectable()
export class CatalogSearchLogService {
  private readonly logger = new Logger(CatalogSearchLogService.name);

  constructor(private readonly database: DatabaseService) {}

  record(rawQuery: unknown, resultCount: unknown): void {
    if (!rawQuery || typeof rawQuery !== "object") return;
    const { offset, q } = rawQuery as { offset?: unknown; q?: unknown };
    if (typeof q !== "string" || (offset !== undefined && Number(offset) !== 0)) return;
    const query = searchLogQuery(q);
    const count = Number(resultCount);
    if (!query || !Number.isInteger(count) || count < 0) return;
    const skip = (error: unknown) => this.logger.warn(`search log skipped: ${error instanceof Error ? error.message : String(error)}`);
    void this.database
      .query("INSERT INTO app.catalog_search_log(query,result_count) VALUES($1,$2)", [query, count])
      .catch(skip);
    // Retention without a separate job: roughly one write in 500 also
    // drops rows older than 180 days (an indexed range delete).
    if (Math.random() < 0.002) {
      void this.database
        .query("DELETE FROM app.catalog_search_log WHERE created_at < now() - interval '180 days'")
        .catch(skip);
    }
  }
}
