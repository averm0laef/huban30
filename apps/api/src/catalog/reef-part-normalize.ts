import { z } from "zod";
import { normalizeArticleNumber, normalizeBrand } from "./catalog-search-normalize.js";

export const ReefPartSchema = z.object({
  article: z.string().min(1).max(200), brand: z.string().min(1).max(200), name: z.string().max(500),
}).strict();
export type ReefPart = z.infer<typeof ReefPartSchema>;

/** Allowlist projection before caching/matching. Never spread provider objects. */
export function reefParts(payload: unknown): ReefPart[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as Record<string,unknown>).data;
  if (!data || typeof data !== "object" || !Array.isArray((data as Record<string,unknown>).parts)) return [];
  const unique = new Map<string,ReefPart>();
  for (const raw of ((data as Record<string,unknown>).parts as unknown[]).slice(0,20)) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string,unknown>;
    if (typeof row.article_number !== "string" || typeof row.brand !== "string") continue;
    const candidate = ReefPartSchema.safeParse({ article:row.article_number.trim(),brand:row.brand.trim(),name:typeof row.title === "string" ? row.title.trim():"" });
    if (!candidate.success || /[\u0000-\u001f\u007f]/u.test(candidate.data.article+candidate.data.brand+candidate.data.name)) continue;
    const article=normalizeArticleNumber(candidate.data.article),brand=normalizeBrand(candidate.data.brand);
    if (!article || !brand) continue;
    unique.set(`${brand}\0${article}`,candidate.data);
  }
  return [...unique.values()];
}
