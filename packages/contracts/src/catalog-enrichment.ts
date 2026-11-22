import { z } from "zod";

export const CatalogEnrichmentQuerySchema = z.object({
  article: z.string().trim().min(3).max(80).regex(/^[\p{L}\p{N} .\-/]+$/u),
  brand: z.string().trim().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]+$/u),
  mode: z.enum(["part", "oe"]).default("part"),
}).strict();
export type CatalogEnrichmentQuery = z.infer<typeof CatalogEnrichmentQuerySchema>;

// Source IDs, URLs, metadata, remote prices and stock are deliberately absent.
export const CatalogEnrichmentCandidateSchema = z.object({
  article: z.string().max(200), brand: z.string().max(200), name: z.string().max(500),
  matchesRequestedIdentity: z.boolean(),
  localProducts: z.array(z.object({
    id: z.uuid(), sku: z.string().max(200), name: z.string().max(500),
    brand: z.string().max(200), isActive: z.boolean(),
  }).strict()).max(10),
}).strict();
export const CatalogEnrichmentResponseSchema = z.object({
  status: z.enum(["ok", "disabled", "unavailable", "limited", "not_found"]),
  message: z.string().max(1_000), candidates: z.array(CatalogEnrichmentCandidateSchema).max(20),
  checkedAt: z.iso.datetime().nullable(),
}).strict();
export type CatalogEnrichmentResponse = z.infer<typeof CatalogEnrichmentResponseSchema>;
