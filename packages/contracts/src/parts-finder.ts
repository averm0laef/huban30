import { z } from "zod";

import { normalizeArticleNumber } from "./catalog-search-normalize.js";

/**
 * "Подбор по автомобилю" (/podbor). The browser talks only to the API
 * (`/api/v1/parts-finder/*`); the API forwards to the internal parts-finder
 * service (services/parts-finder) and adds `shop` offers from the АН-30
 * catalog. Responses of that service keep its own snake_case fields, so the
 * response schemas below are loose: unknown fields pass through unchanged.
 */

const SAFE_SINGLE_LINE = /^[^\u0000-\u001F\u007F]+$/u;

/** Step names the service asks the customer to pick (`choices` keys). */
export const PARTS_FINDER_CHOICE_FIELDS = [
  "article",
  "engine",
  "local_variant",
  "make",
  "model",
  "modification",
  "node",
  "version",
] as const;
export const PartsFinderChoiceFieldSchema = z.enum(PARTS_FINDER_CHOICE_FIELDS);
export type PartsFinderChoiceField = z.infer<typeof PartsFinderChoiceFieldSchema>;

const PositiveId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** A car picked in the make -> model -> modification picker (ids from /parts-finder/models|modifications). */
export const PartsFinderSelectedVehicleSchema = z.object({
  modelId: PositiveId.optional(),
  modificationId: PositiveId.optional(),
}).refine((value) => value.modelId !== undefined || value.modificationId !== undefined, "modelId or modificationId");
export type PartsFinderSelectedVehicle = z.infer<typeof PartsFinderSelectedVehicleSchema>;

export const PartsFinderSearchRequestSchema = z.object({
  choices: z.partialRecord(PartsFinderChoiceFieldSchema, PositiveId).optional(),
  confirmed: z.boolean().optional(),
  query: z.string().trim().min(1).max(140).regex(SAFE_SINGLE_LINE),
  // With a picked car the query only needs the part ("масляный фильтр").
  vehicle: PartsFinderSelectedVehicleSchema.optional(),
});
export type PartsFinderSearchRequest = z.infer<typeof PartsFinderSearchRequestSchema>;

export const PartsFinderVehicleRequestSchema = z.object({
  vin: z.string().trim().min(1).max(32).regex(SAFE_SINGLE_LINE),
});
export type PartsFinderVehicleRequest = z.infer<typeof PartsFinderVehicleRequestSchema>;

export const PartsFinderCrossesRequestSchema = z.object({
  article: z.string().trim().min(1).max(64).regex(SAFE_SINGLE_LINE),
  manufacturer_id: PositiveId.optional(),
});
export type PartsFinderCrossesRequest = z.infer<typeof PartsFinderCrossesRequestSchema>;

export const PartsFinderShopAnalogsRequestSchema = z.object({
  article: z.string().trim().min(1).max(64).regex(SAFE_SINGLE_LINE),
  brand: z.string().trim().min(1).max(100).regex(SAFE_SINGLE_LINE).optional(),
  /** What the part is called (a parts catalogue's description): another maker's product of the number must be that kind of part. */
  name: z.string().trim().min(1).max(200).regex(SAFE_SINGLE_LINE).optional(),
  /** The product card asking: the API reads the product's own brand, section and name. */
  productId: z.string().uuid().optional(),
});
export type PartsFinderShopAnalogsRequest = z.infer<typeof PartsFinderShopAnalogsRequestSchema>;

/**
 * A product of the АН-30 catalog for a part: only active, non-deleted,
 * publicly visible products.
 *  - `exact`: the same normalised article;
 *  - `cross`: a confirmed pair of app.article_crosses (a vehicle maker's own
 *    number, a replacement, a manufacturer-verified analog, a pair two
 *    sources agree on, or one a staff member confirmed);
 *  - `possible`: a pair only one source asserted, or two parts that share an
 *    original number. Shown as «возможный аналог»: a specialist checks the
 *    fit before it is sold as the answer.
 */
export const ShopOfferSchema = z.object({
  availableQuantity: z.number().int().min(0),
  brand: z.string().nullable(),
  matchedVia: z.enum(["exact", "cross", "possible"]),
  name: z.string(),
  priceKopeks: z.number().int().min(0).nullable(),
  productId: z.string().min(1),
  sku: z.string(),
  slug: z.string(),
});
export type ShopOffer = z.infer<typeof ShopOfferSchema>;

export const PARTS_FINDER_OFFERS_PER_PART = 5;
export const PARTS_FINDER_SHOP_ANALOGS_LIMIT = 20;

export const PartsFinderPartSchema = z.looseObject({
  article: z.string(),
  brand: z.string().optional(),
  description: z.string().optional(),
  manufacturer_id: z.number().int().optional(),
  oem: z.boolean().optional(),
  shop: z.array(ShopOfferSchema).optional(),
  source: z.string().optional(),
});
export type PartsFinderPart = z.infer<typeof PartsFinderPartSchema>;

export const PARTS_FINDER_SEARCH_STATUSES = [
  "article", "choose", "confirm", "found", "keyword", "need_detail", "need_vehicle", "no_data", "reference",
] as const;

export const PartsFinderSearchResponseSchema = z.looseObject({
  article: z.string().optional(),
  category: z.string().optional(),
  choices: z.record(z.string(), z.number()).optional(),
  engine: z.string().optional(),
  field: z.string().optional(),
  message: z.string().optional(),
  options: z.array(z.looseObject({ id: z.number(), label: z.string() })).optional(),
  parts: z.array(PartsFinderPartSchema).optional(),
  shop: z.array(ShopOfferSchema).optional(),
  status: z.string(),
  vehicle: z.string().optional(),
});
export type PartsFinderSearchResponse = z.infer<typeof PartsFinderSearchResponseSchema>;

export const PartsFinderCrossesResponseSchema = z.looseObject({
  article: z.string(),
  candidates: z.array(PartsFinderPartSchema).optional(),
  current: PartsFinderPartSchema.optional(),
  groups: z.record(z.string(), z.array(PartsFinderPartSchema)).optional(),
  part: PartsFinderPartSchema.optional(),
  part_status: z.enum(["current", "replaced"]).optional(),
  status: z.enum(["choose_brand", "found", "no_data"]),
});
export type PartsFinderCrossesResponse = z.infer<typeof PartsFinderCrossesResponseSchema>;

export const PartsFinderStatusResponseSchema = z.object({
  /** Which vehicle catalogue the picker uses: TecDoc when its key is set, else the shop's own list. */
  catalog: z.enum(["tecdoc", "local"]).optional(),
  enabled: z.boolean(),
});
export type PartsFinderStatusResponse = z.infer<typeof PartsFinderStatusResponseSchema>;

export const PartsFinderShopAnalogsResponseSchema = z.object({
  article: z.string(),
  offers: z.array(ShopOfferSchema).max(PARTS_FINDER_SHOP_ANALOGS_LIMIT),
});
export type PartsFinderShopAnalogsResponse = z.infer<typeof PartsFinderShopAnalogsResponseSchema>;

/** Error body of every parts-finder route: a stable code plus a Russian message for the customer. */
export const PartsFinderErrorSchema = z.object({
  code: z.string(),
  error: z.string(),
});
export type PartsFinderError = z.infer<typeof PartsFinderErrorSchema>;

export const PARTS_FINDER_UNAVAILABLE_MESSAGE = "Подбор по автомобилю временно недоступен. Попробуйте поиск по каталогу.";
export const PARTS_FINDER_DISABLED_MESSAGE = "Подбор по автомобилю пока не подключён. Попробуйте поиск по каталогу.";

export const PartsFinderResolveRequestSchema = z.object({
  // false: do not count this call in the search log (the page re-resolving a query the header already counted).
  log: z.boolean().optional(),
  query: z.string().trim().min(1).max(140).regex(SAFE_SINGLE_LINE),
  // false: classify only, skip the supplier lookup (fast answer for the header search).
  supplier: z.boolean().optional(),
});
export type PartsFinderResolveRequest = z.infer<typeof PartsFinderResolveRequestSchema>;

/**
 * One classification for the header search:
 *  - vin: a VIN or chassis number, decoded (`vehicle` = /parts-finder/vehicle answer, or null + `error`);
 *  - article: a part number with the shop's offers (exact + own confirmed crosses) and supplier
 *    "под заказ" offers (retail price, distributor never named);
 *  - vehicle_part: "деталь + машина" — `search` is the first guided step (/parts-finder/search answer);
 *  - text: anything else — run the ordinary catalog search with `query`.
 */
export type PartsFinderResolveKind = "article" | "text" | "vehicle_part" | "vin";

export const PartsFinderResolveResponseSchema = z.looseObject({
  alternatives: z.array(z.string()).optional(),
  article: z.string().optional(),
  error: z.string().optional(),
  kind: z.enum(["article", "text", "vehicle_part", "vin"]),
  query: z.string(),
  search: PartsFinderSearchResponseSchema.optional(),
  shop: z.array(ShopOfferSchema).optional(),
  supplier: z.looseObject({ parts: z.array(z.unknown()), totalFound: z.number(), truncated: z.boolean() }).nullable().optional(),
  vehicle: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type PartsFinderResolveResponse = z.infer<typeof PartsFinderResolveResponseSchema>;

export const PickerMakeSchema = z.object({
  country: z.string().nullable(),
  id: z.number().int(),
  name: z.string(),
  nameRu: z.string().nullable(),
  slug: z.string(),
});
export type PickerMake = z.infer<typeof PickerMakeSchema>;

export const PickerModelSchema = z.object({
  /** Body type in Russian («универсал»), when the catalogue names one. */
  body: z.string().nullable().optional(),
  /** The model as people call it ("Caldina"); `name` is one generation of it. */
  family: z.string().optional(),
  fapi: z.boolean(),
  /** What tells generations apart: body code and series ("T21", "IX · X11"). */
  generation: z.string().nullable().optional(),
  id: z.number().int(),
  name: z.string(),
  yearFrom: z.number().int().nullable(),
  yearTo: z.number().int().nullable(),
});
export type PickerModel = z.infer<typeof PickerModelSchema>;

export const PickerModificationSchema = z.object({
  body: z.string().nullable(),
  capacity: z.string().nullable(),
  engine: z.string().nullable(),
  fuel: z.string().nullable().optional(),
  powerPs: z.number().int().nullable().optional(),
  id: z.number().int(),
  label: z.string(),
  yearFrom: z.number().int().nullable(),
  yearTo: z.number().int().nullable(),
});
export type PickerModification = z.infer<typeof PickerModificationSchema>;

export const PickerMakesResponseSchema = z.object({
  groups: z.array(z.object({ letter: z.string(), makes: z.array(PickerMakeSchema) })),
  popular: z.array(PickerMakeSchema),
});
export type PickerMakesResponse = z.infer<typeof PickerMakesResponseSchema>;

export const PickerModelsResponseSchema = z.object({
  make: PickerMakeSchema,
  models: z.array(PickerModelSchema),
  /** Model names shown first: the ones most often asked for in the shop's region. */
  popular: z.array(z.string()).optional(),
  source: z.enum(["fapi", "seed", "tecdoc"]),
});
export type PickerModelsResponse = z.infer<typeof PickerModelsResponseSchema>;

export const PickerModificationsResponseSchema = z.object({
  available: z.boolean(),
  message: z.string().optional(),
  model: PickerModelSchema,
  modifications: z.array(PickerModificationSchema),
});
export type PickerModificationsResponse = z.infer<typeof PickerModificationsResponseSchema>;

export const PickerSuggestResponseSchema = z.object({
  items: z.array(z.object({ label: z.string(), make: PickerMakeSchema, model: PickerModelSchema.nullable() })),
});
export type PickerSuggestResponse = z.infer<typeof PickerSuggestResponseSchema>;

export const PickerModelsQuerySchema = z.object({ make: z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/u) });
export const PickerModificationsQuerySchema = z.object({ model: z.coerce.number().int().positive().max(2_147_483_647) });
export const PickerSuggestQuerySchema = z.object({ q: z.string().trim().min(1).max(60).regex(SAFE_SINGLE_LINE) });

/** Staff card «Подбор и поставщики». */
export const PartsFinderStaffOverviewSchema = z.object({
  fapi: z.object({
    cacheEntries: z.number(),
    cacheHits: z.number(),
    checkedAt: z.string().nullable(),
    configured: z.boolean(),
    dailyLimit: z.number(),
    fitmentEnabled: z.boolean(),
    /** One visitor's share of the day's credits. */
    visitorDailyLimit: z.number(),
    packageRemaining: z.number().nullable(),
    plan: z.string().nullable(),
    status: z.string().nullable(),
    usedToday: z.number(),
  }),
  supplier: z.object({
    enabled: z.boolean(),
    lastError: z.object({ at: z.string(), message: z.string() }).nullable(),
    lastSuccessAt: z.string().nullable(),
  }),
  vin: z.object({ cacheEntries: z.number(), cacheHits: z.number(), vinrokuRemaining: z.number().nullable() }),
});
export type PartsFinderStaffOverview = z.infer<typeof PartsFinderStaffOverviewSchema>;

/** Storefront sections whose goods have no part-number catalogue (fluids, chemistry, tools): never looked up. */
export const UNLINKABLE_SECTIONS: readonly string[] = [
  "motornye-masla", "transmissionnye-masla", "antifriz", "gidravlicheskaya-zhidkost", "avtohimiya", "instrumenty", "tehosmotr", "aksessuary",
];

/**
 * Whether a parts catalogue (TecDoc, FAPI) can say which cars a product fits: a part with its maker known and a
 * number of at least four characters, outside UNLINKABLE_SECTIONS (`section` is the top-level storefront section).
 * Anything else is never looked up: the product page offers a check by VIN instead.
 */
export function partNumberCatalogueApplies(product: { brand: string | null; section: string | null; sku: string }): boolean {
  if (!product.brand || normalizeArticleNumber(product.sku).length < 4) return false;
  return !product.section || !UNLINKABLE_SECTIONS.includes(product.section);
}
