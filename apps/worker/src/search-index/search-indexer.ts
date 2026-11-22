// Keeps the optional search engine in step with PostgreSQL
// (docs/SEARCH_ENGINE.md):
//
//   - drainQueue(): app.search_index_queue (filled by triggers inside every
//     catalog transaction, migration 0035) -> bulk index / delete. A row is
//     removed only if it was not re-queued while we were indexing it.
//   - reindexAll(): build a fresh `${alias}-<timestamp>` index from every
//     visible product, then switch the alias to it in one atomic call and
//     drop the old indices. Searches keep hitting the old index until the
//     switch, so a reindex never shows a half-empty catalog.

import type { Logger } from "pino";

import { SEARCH_INDEX_DEFINITION } from "./index-definition.js";
import type { SearchEngineHttp, SearchEngineResponse } from "./opensearch-http.js";
import { loadProductDocumentPage, loadProductDocuments, type ProductDocument } from "./product-documents.js";

interface Queryable {
  query<Row>(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}

interface QueueRow {
  enqueued_at: Date;
  product_id: string;
}

// Session-level lock so two worker processes never drain the same rows.
const DRAIN_LOCK_KEY = 0x616e3330; // "an30"

function assertOk(response: SearchEngineResponse, action: string): void {
  if (response.status >= 300) throw new Error(`${action}_failed_${response.status}`);
  const body = response.body as { errors?: boolean; items?: Array<Record<string, { error?: { reason?: string }; status?: number }>> } | null;
  if (body?.errors) {
    const failed = body.items?.map((item) => Object.values(item)[0]).find((result) => result?.error && result.status !== 404);
    if (failed) throw new Error(`${action}_item_failed: ${failed.error?.reason ?? "unknown"}`.slice(0, 500));
  }
}

function bulkLines(index: string, documents: ProductDocument[], removedIds: string[] = []): unknown[] {
  const lines: unknown[] = [];
  for (const document of documents) lines.push({ index: { _index: index, _id: document.id } }, document);
  for (const id of removedIds) lines.push({ delete: { _index: index, _id: id } });
  return lines;
}

export class SearchIndexer {
  private draining = false;

  constructor(
    private readonly database: { connect(): Promise<Queryable & { release(): void }> } & Queryable,
    private readonly engine: SearchEngineHttp,
    private readonly alias: string,
    private readonly batchSize: number,
    private readonly logger: Pick<Logger, "info" | "warn">,
  ) {}

  /** Index up to one batch of queued products; returns how many were handled. */
  async drainQueue(): Promise<number> {
    if (this.draining) return 0;
    this.draining = true;
    const client = await this.database.connect();
    try {
      const locked = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [DRAIN_LOCK_KEY]);
      if (!locked.rows[0]?.locked) return 0;
      try {
        const queued = (await client.query<QueueRow>(
          `SELECT product_id,enqueued_at FROM app.search_index_queue
           ORDER BY enqueued_at LIMIT $1`,
          [this.batchSize],
        )).rows;
        if (queued.length === 0) return 0;
        const ids = queued.map((row) => row.product_id);
        try {
          const documents = await loadProductDocuments(client, ids);
          const indexed = new Set(documents.map((document) => document.id));
          const response = await this.engine.bulk(bulkLines(this.alias, documents, ids.filter((id) => !indexed.has(id))));
          assertOk(response, "bulk");
        } catch (error) {
          const reason = error instanceof Error ? error.message.slice(0, 500) : "unknown_error";
          await client.query(
            `UPDATE app.search_index_queue SET attempt_count=attempt_count+1,last_error=$2
             WHERE product_id=ANY($1::uuid[])`,
            [ids, reason],
          );
          this.logger.warn({ count: ids.length, reason }, "Search index update deferred");
          return 0;
        }
        await client.query(
          `DELETE FROM app.search_index_queue AS queue
           USING unnest($1::uuid[],$2::timestamptz[]) AS done(product_id,enqueued_at)
           WHERE queue.product_id=done.product_id AND queue.enqueued_at=done.enqueued_at`,
          [ids, queued.map((row) => row.enqueued_at)],
        );
        return ids.length;
      } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [DRAIN_LOCK_KEY]);
      }
    } finally {
      client.release();
      this.draining = false;
    }
  }

  /** Full rebuild into a new index and an atomic alias switch. */
  async reindexAll(now: Date = new Date()): Promise<{ index: string; documents: number }> {
    const startedAt = now;
    const index = `${this.alias}-${now.toISOString().replace(/[^0-9]/gu, "").slice(0, 14)}`;
    const existing = await this.engine.request("GET", `/_alias/${this.alias}`);
    const previous = existing.status === 200 && existing.body && typeof existing.body === "object"
      ? Object.keys(existing.body as Record<string, unknown>)
      : [];
    const concrete = await this.engine.request("HEAD", `/${this.alias}`);
    if (concrete.status === 200 && previous.length === 0) {
      throw new Error(`"${this.alias}" is a concrete index, not an alias; delete it or choose another OPENSEARCH_INDEX`);
    }
    assertOk(await this.engine.request("PUT", `/${index}`, SEARCH_INDEX_DEFINITION), "create_index");

    let documents = 0;
    let after: string | null = null;
    for (;;) {
      const page = await loadProductDocumentPage(this.database, after, this.batchSize);
      if (page.length === 0) break;
      assertOk(await this.engine.bulk(bulkLines(index, page)), "bulk");
      documents += page.length;
      after = page.at(-1)!.id;
      this.logger.info({ documents, index }, "Search reindex progress");
    }
    assertOk(await this.engine.request("POST", `/${index}/_refresh`), "refresh");
    assertOk(await this.engine.request("POST", "/_aliases", {
      actions: [
        ...previous.map((old) => ({ remove: { index: old, alias: this.alias } })),
        { add: { index, alias: this.alias } },
      ],
    }), "alias_switch");
    for (const old of previous) await this.engine.request("DELETE", `/${old}`);
    // Changes committed after the start are still queued and re-applied by drainQueue().
    await this.database.query("DELETE FROM app.search_index_queue WHERE enqueued_at<$1", [startedAt]);
    this.logger.info({ documents, index, previous }, "Search reindex finished");
    return { documents, index };
  }
}
