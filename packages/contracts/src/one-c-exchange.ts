import { z } from "zod";

// Query-parameter contract for the standard 1С «Обмен с сайтом» (CommerceML 2)
// exchange endpoint. 1С drives the whole exchange through `type`/`mode` on a
// single URL — see https://v8.1c.ru/tekhnologii/obmen-dannymi-i-integratsiya/standarty-i-formaty/protokol-obmena-s-saytom/
// This is intentionally separate from the bespoke JSON envelope in
// `OneCImportEnvelopeSchema` (index.ts): that schema describes the row shape
// both transports eventually feed into the same staging pipeline, while this
// one describes the wire protocol 1С itself speaks.
export const ONE_C_EXCHANGE_TYPES = ["catalog", "sale"] as const;
export const OneCExchangeTypeSchema = z.enum(ONE_C_EXCHANGE_TYPES);
export type OneCExchangeType = z.infer<typeof OneCExchangeTypeSchema>;

export const ONE_C_EXCHANGE_MODES = [
  "checkauth",
  "init",
  "file",
  "import",
  "query",
  "success",
] as const;
export const OneCExchangeModeSchema = z.enum(ONE_C_EXCHANGE_MODES);
export type OneCExchangeMode = z.infer<typeof OneCExchangeModeSchema>;

// 1С sends the filename as a slash-separated relative path (sometimes nested
// under a dated folder), e.g. "import_files/20260805/import.xml". An
// allowlist of the characters 1С actually uses keeps this simple and, unlike
// a control-character blocklist, fails closed on anything unexpected. The
// exchange service re-validates and re-sanitises it again before touching
// the filesystem (see one-c-exchange-temp-storage.service.ts) — this only
// bounds shape at the transport boundary.
const OneCExchangeFilenameSchema = z.string().trim().min(1).max(400)
  .regex(/^[A-Za-z0-9._/-]+$/u);

export const OneCExchangeQuerySchema = z.object({
  filename: OneCExchangeFilenameSchema.optional(),
  mode: OneCExchangeModeSchema,
  type: OneCExchangeTypeSchema,
}).strict();
export type OneCExchangeQuery = z.infer<typeof OneCExchangeQuerySchema>;
