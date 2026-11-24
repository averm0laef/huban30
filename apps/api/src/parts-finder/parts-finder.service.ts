import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger, Optional } from "@nestjs/common";

import {
  PARTS_FINDER_DISABLED_MESSAGE,
  PARTS_FINDER_OFFERS_PER_PART,
  PARTS_FINDER_SHOP_ANALOGS_LIMIT,
  PARTS_FINDER_UNAVAILABLE_MESSAGE,
  PartsFinderCrossesRequestSchema,
  PartsFinderResolveRequestSchema,
  PartsFinderSearchRequestSchema,
  PartsFinderShopAnalogsRequestSchema,
  PartsFinderVehicleRequestSchema,
  PickerModelsQuerySchema,
  PickerModificationsQuerySchema,
  PickerSuggestQuerySchema,
  VehicleUnderstandQuerySchema,
  type PartsFinderResolveResponse,
  type PartsFinderShopAnalogsResponse,
  type PartsFinderStaffOverview,
  type PartsFinderStatusResponse,
  type ShopOffer,
  type SupplierSearchResponse,
} from "@an30/contracts";
import type { z } from "zod";

import { SUPPLIER_PROVIDER, type SupplierProvider } from "../adapters/provider-contracts.js";
import { CatalogPublicService } from "../catalog/catalog-public.service.js";
import { CatalogSearchLogService } from "../catalog/catalog-search-log.service.js";
import { RedisService } from "../infrastructure/redis.service.js";
import { SupplierSearchService } from "../suppliers/supplier-search.service.js";
import { PartsFinderError } from "./engine/errors.js";
import { findEngine, isEngineCode } from "./engine/part-query.js";
import { normalizeChassis } from "./engine/vin-decoder.js";
import { type FapiPayer, PartsFinderEngine } from "./parts-finder.engine.js";
import { PartsFinderCrossStore, crossRowsFromSupplier } from "./parts-finder-crosses.store.js";
import type { TecdocCaller } from "../tecdoc/tecdoc.gateway.js";
import { TecdocService } from "../tecdoc/tecdoc.service.js";
import { normalizeQuery } from "./engine/part-query.js";
import { CATEGORIES } from "./engine/vehicle-parts.js";
import { PartsFinderShopService, type ShopOfferLookup, type ShopOfferRequest } from "./parts-finder-shop.service.js";
import { PartsFinderVehiclesService } from "./parts-finder-vehicles.service.js";

type JsonRecord = Record<string, unknown>;
type PartRecord = JsonRecord & { article: string; brand?: unknown; shop?: ShopOffer[] };

const INVALID_REQUEST = "Проверьте запрос и повторите.";
// FAPI cards looked up when none of the fitting articles is in our catalog.
const AUTO_CROSS_CARDS = 5;
const AUTO_FAPI_CARDS_PER_HOUR = 120;
const SUPPLIER_ERROR_KEY = "an30:parts-finder:supplier:last-error";
const SUPPLIER_SUCCESS_KEY = "an30:parts-finder:supplier:last-success";
const VIN_SHAPE = /^[A-HJ-NPR-Z0-9]{17}$/iu;

const CATALOGUE_OUTAGE_MESSAGE = "Каталог аналогов сейчас недоступен. Наш каталог работает, а специалист подберёт деталь вручную — напишите нам.";

/** The paid catalogue refused for a reason the customer cannot fix (credits, limit, key, outage). */
function isCatalogueOutage(error: PartsFinderError): boolean {
  return error.code.startsWith("fapi_") && error.code !== "fapi_invalid_query";
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPart(value: unknown): value is PartRecord {
  return isRecord(value) && typeof value.article === "string" && value.article.length > 0;
}

function partRequest(part: PartRecord): ShopOfferRequest {
  return {
    article: part.article,
    brand: typeof part.brand === "string" ? part.brand : null,
    // FAPI's description of the part («Фильтр масляный»): our product of the number without a maker must be that kind of part.
    name: typeof part.description === "string" ? part.description : null,
  };
}

function parse<Schema extends z.ZodType>(schema: Schema, body: unknown): z.infer<Schema> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new BadRequestException({ code: "parts_finder_invalid_request", error: INVALID_REQUEST });
  }
  return parsed.data;
}

/** In-stock shop offer first, then any shop offer, then the rest; stable otherwise. */
export function rankByShop<T>(parts: readonly T[]): T[] {
  const score = (part: T) => {
    const offers = isRecord(part) && Array.isArray(part.shop) ? part.shop as ShopOffer[] : [];
    if (offers.some((offer) => offer.availableQuantity > 0)) return 0;
    return offers.length > 0 ? 1 : 2;
  };
  return parts
    .map((part, index) => ({ index, part, score: score(part) }))
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map(({ part }) => part);
}

function resultCount(result: PartsFinderResolveResponse): number {
  if (result.kind === "vin") return result.vehicle ? 1 : 0;
  if (result.kind === "article") return (result.shop?.length ?? 0) + (result.supplier?.parts.length ?? 0);
  const parts = result.search?.parts;
  return Array.isArray(parts) ? parts.length : Array.isArray(result.search?.options) ? result.search.options.length : 0;
}

/** A VIN or a chassis number typed into the header search (spaces and dashes tolerated in a VIN). */
export function looksLikeVehicleId(query: string): boolean {
  // Japanese chassis codes start with letters (MXPH14-…); "04152-40060" is a part number.
  const chassis = normalizeChassis(query);
  if (chassis) return /^[A-Z]{2,}/u.test(chassis);
  const compact = query.replace(/[\s-]/gu, "");
  return VIN_SHAPE.test(compact) && /[A-Z]/iu.test(compact) && /\d/u.test(compact);
}

/**
 * «Подбор по автомобилю», native part of the API (port of the owner's
 * module, docs/PARTS_FINDER.md). Validates input, maps failures to stable
 * codes and adds the shop's own offers (exact article + confirmed crosses)
 * to every part; supplier ("под заказ") offers come last.
 */
@Injectable()
export class PartsFinderService {
  private readonly logger = new Logger(PartsFinderService.name);

  constructor(
    private readonly engine: PartsFinderEngine,
    private readonly shop: PartsFinderShopService,
    private readonly vehicles: PartsFinderVehiclesService,
    private readonly suppliers: SupplierSearchService,
    @Inject(SUPPLIER_PROVIDER) private readonly supplierProvider: SupplierProvider,
    private readonly redis: RedisService,
    private readonly searchLog: CatalogSearchLogService,
    private readonly crossStore: PartsFinderCrossStore,
    private readonly catalog: CatalogPublicService,
    @Optional() private readonly tecdoc?: TecdocService,
  ) {}

  /**
   * True when the query is a product name with a size, not a part number: it has a word, and the catalog search
   * finds products that match every word of it. A number the shop does not keep («VKBA 3247») matches none.
   */
  private async catalogAnswers(query: string): Promise<boolean> {
    if (!/\p{L}{3,}/u.test(query)) return false;
    try {
      const page = await this.catalog.products({ availability: "all", limit: 1, offset: 0, q: query, sort: "relevance" });
      return page.matchMode === "all" && page.total > 0;
    } catch {
      return false;
    }
  }

  /**
   * The picker reads the UMAPI vehicle catalog (docs/UMAPI.md). Only while it
   * is not loaded yet and a TecDoc key is set does TecDoc answer for cars.
   */
  status(): PartsFinderStatusResponse {
    const catalog = !this.vehicles.usesCatalog && this.tecdoc?.available ? "tecdoc" : "umapi";
    return { catalog, enabled: this.engine.enabled };
  }

  // `caller` is the visitor a public route answers: what the paid catalogue costs is counted against that
  // visitor's share of the day. Without it (staff, tests) the shop pays.
  async search(body: unknown, caller?: TecdocCaller): Promise<JsonRecord> {
    const payer = caller?.ip ?? null;
    const request = parse(PartsFinderSearchRequestSchema, body);
    const form: JsonRecord = { query: request.query };
    if (request.confirmed !== undefined) form.confirmed = request.confirmed;
    if (request.choices && Object.keys(request.choices).length > 0) form.choices = { ...request.choices };
    let vehicleLabel: string | null = null;
    if (request.vehicle) {
      const car = await this.run(() => this.vehicles.selected(request.vehicle!));
      vehicleLabel = car.label;
      // The picked car joins the part words; FAPI ids become already-confirmed steps.
      const words = [request.query, car.make, car.model];
      if (car.engine && isEngineCode(car.engine.toLowerCase()) && !findEngine(request.query.toLowerCase())) words.push(car.engine);
      if (car.capacity && /^\d[.,]\d$/u.test(car.capacity)) words.push(`${car.capacity} л`);
      form.query = words.join(" ").slice(0, 140);
      const choices = { ...(form.choices as JsonRecord | undefined) };
      if (car.fapiMakeId) choices.make ??= car.fapiMakeId;
      if (car.fapiModelId) choices.model ??= car.fapiModelId;
      if (car.fapiModificationId) choices.modification ??= car.fapiModificationId;
      form.choices = choices;
      form.confirmed = true;
    }
    const result = await this.guided(form, payer);
    if (vehicleLabel) result.selected_vehicle = vehicleLabel;
    return result;
  }

  async vehicle(body: unknown): Promise<JsonRecord> {
    const request = parse(PartsFinderVehicleRequestSchema, body);
    return this.run(() => this.engine.vehicle(request.vin));
  }

  async crosses(body: unknown, caller?: TecdocCaller): Promise<JsonRecord> {
    const request = parse(PartsFinderCrossesRequestSchema, body);
    const result = await this.run(() => this.engine.crosses(request, caller?.ip ?? null));
    await this.crossStore.remember(result);
    const groups = isRecord(result.groups) ? result.groups : null;
    const candidates = Array.isArray(result.candidates) ? result.candidates : null;
    const requests: ShopOfferRequest[] = [];
    for (const single of [result.part, result.current]) if (isPart(single)) requests.push(partRequest(single));
    for (const list of [...Object.values(groups ?? {}), candidates ?? []]) {
      if (Array.isArray(list)) requests.push(...list.filter(isPart).map(partRequest));
    }
    const offers = await this.shop.lookup(requests, PARTS_FINDER_OFFERS_PER_PART);
    const enriched: JsonRecord = { ...result };
    if (isPart(result.part)) enriched.part = this.withShop(result.part, offers);
    if (isPart(result.current)) enriched.current = this.withShop(result.current, offers);
    if (groups) {
      enriched.groups = Object.fromEntries(Object.entries(groups).map(([name, list]) => [
        name,
        Array.isArray(list) ? rankByShop(list.map((part) => this.withShop(part, offers))) : list,
      ]));
    }
    if (candidates) enriched.candidates = candidates.map((part) => this.withShop(part, offers));
    return enriched;
  }

  /** Shop's own catalog only (the same part, crosses, the same standard size): free, always available. */
  async shopAnalogs(body: unknown): Promise<PartsFinderShopAnalogsResponse> {
    const request = parse(PartsFinderShopAnalogsRequestSchema, body);
    const [lookup, sameSize] = await Promise.all([
      this.shop.lookup([request], PARTS_FINDER_SHOP_ANALOGS_LIMIT),
      // A product card also gets the parts of its standard size (a belt, a lamp, a bearing…) from any maker.
      request.productId ? this.shop.sameSize(request.productId, PARTS_FINDER_SHOP_ANALOGS_LIMIT) : Promise.resolve(null),
    ]);
    const offers = lookup.for(request);
    const offered = new Set([request.productId, ...offers.map((offer) => offer.productId)]);
    const sized = sameSize ? sameSize.offers.filter((offer) => !offered.has(offer.productId)) : [];
    return { article: request.article, offers, ...(sameSize && sized.length > 0 ? { sameSize: { label: sameSize.label, offers: sized } } : {}) };
  }

  /**
   * One endpoint for the header search: VIN / chassis -> decoded car;
   * part number -> our catalog (exact, then own crosses) and supplier offers;
   * "деталь + машина" -> first guided step; anything else -> catalog search.
   */
  async resolve(body: unknown, caller?: TecdocCaller): Promise<PartsFinderResolveResponse> {
    const { log, query, supplier } = parse(PartsFinderResolveRequestSchema, body);
    const result = await this.classify(query, supplier !== false, caller);
    // "text" goes on to the catalog search, which logs it itself.
    if (result.kind !== "text" && log !== false) this.searchLog.record({ q: query }, resultCount(result));
    return result;
  }

  private async classify(query: string, withSupplier: boolean, caller?: TecdocCaller): Promise<PartsFinderResolveResponse> {
    // TecDoc answers only the full request of a visitor, never the header's routing-only call.
    const tecdoc = withSupplier && caller && this.tecdoc?.available ? this.tecdoc : null;
    if (looksLikeVehicleId(query)) {
      const compact = normalizeChassis(query) ?? query.replace(/[\s-]/gu, "").toUpperCase();
      try {
        return { kind: "vin", query, vehicle: await this.run(() => this.engine.vehicle(compact)) };
      } catch (error) {
        const message = error instanceof HttpException ? this.messageOf(error) : PARTS_FINDER_UNAVAILABLE_MESSAGE;
        return { error: message, kind: "vin", query, vehicle: null };
      }
    }
    if (!this.engine.enabled) return { kind: "text", query };
    let first: JsonRecord;
    try {
      first = await this.run(() => this.engineSearch({ query }, caller?.ip ?? null));
    } catch {
      return { kind: "text", query };
    }
    if (first.status === "article" || (first.status === "choose" && first.field === "article")) {
      const spellings = first.status === "article"
        ? [String(first.article)]
        : (Array.isArray(first.options) ? first.options : []).flatMap((option) => (isRecord(option) && typeof option.label === "string" ? [option.label] : []));
      const offers = await this.shop.lookup(spellings.map((article) => ({ article, brand: null })), PARTS_FINDER_SHOP_ANALOGS_LIMIT);
      // Of two possible spellings ("ДКс 0127" / "LRC 0127") prefer the one the shop sells.
      const article = spellings.find((spelling) => offers.for({ article: spelling }).length > 0) ?? spellings.at(-1)!;
      // «04152-40060» is kept in 1С as «04152-40060 (O-117)», «32215» as «7515 (32215)»: the shop does sell them.
      const filed = await this.shop.filedUnder(spellings);
      const filedOffers = filed.length === 0 ? [] : await this.shop.lookup(filed.map((sku) => ({ article: sku, brand: null })), PARTS_FINDER_SHOP_ANALOGS_LIMIT)
        .then((found) => filed.flatMap((sku) => found.for({ article: sku })));
      const withFiled = (exact: ShopOffer[]): ShopOffer[] => {
        const seen = new Set(exact.map((offer) => offer.productId));
        return [...exact, ...filedOffers.filter((offer) => !seen.has(offer.productId) && seen.add(offer.productId))];
      };
      let shop = withFiled(offers.for({ article }));
      // «масло 5w40», «лампа h7», «коробка 9» are a word and a size, and no number the shop keeps: the catalog search answers.
      if (shop.length === 0 && await this.catalogAnswers(query)) return { kind: "text", query };
      const supplier = withSupplier ? await this.supplierOffers(article) : null;
      // Nothing of ours in stock under this number: the catalogue names its
      // analogs (one call, short cache) and our catalog is asked for those —
      // matched for this answer only, nothing is stored.
      if (tecdoc && !shop.some((offer) => offer.availableQuantity > 0)) {
        const viaCatalogue = await tecdoc.offersForNumber(article, caller!).catch(() => null);
        const known = new Set(shop.map((offer) => offer.productId));
        if (viaCatalogue) shop = [...shop, ...viaCatalogue.shop.filter((offer) => !known.has(offer.productId))];
      }
      // Nothing of ours on the shelf for this number: learn its analogs from
      // the supplier's answer (free) and its FAPI card (1 credit, cached),
      // then ask our catalog again. The routing-only call (supplier: false)
      // never spends anything.
      if (withSupplier && !shop.some((offer) => offer.availableQuantity > 0) && await this.learnArticle(article, supplier, caller?.ip ?? null)) {
        shop = withFiled((await this.shop.lookup([{ article, brand: null }], PARTS_FINDER_SHOP_ANALOGS_LIMIT)).for({ article }));
      }
      return {
        alternatives: spellings.filter((spelling) => spelling !== article),
        article,
        kind: "article",
        query,
        shop,
        supplier,
      };
    }
    if (tecdoc && (first.status === "confirm" || (first.status === "no_data" && typeof first.vehicle === "string"))) {
      const found = await this.tecdocTextSearch(query, first, tecdoc, caller!);
      if (found) return { kind: "vehicle_part", query, search: found as PartsFinderResolveResponse["search"] };
    }
    if (["choose", "confirm", "reference", "found"].includes(String(first.status))
      || (first.status === "no_data" && typeof first.vehicle === "string")) {
      return { kind: "vehicle_part", query, search: await this.enrichSearch(first, caller?.ip ?? null) as PartsFinderResolveResponse["search"] };
    }
    return { kind: "text", query };
  }

  /**
   * «Деталь + машина» typed as text, answered by the catalogue's own search
   * (one call) and matched to our stock. Null when it finds nothing or is
   * unavailable: the usual flow then answers.
   */
  private async tecdocTextSearch(query: string, first: JsonRecord, tecdoc: TecdocService, caller: TecdocCaller): Promise<JsonRecord | null> {
    try {
      const { tokens } = normalizeQuery(query, CATEGORIES, await this.vehicles.vocabulary());
      // The car first, as the provider's examples do: "toyota gaia топливный фильтр".
      const car = tokens.filter((token) => /^[a-z0-9.-]+$/u.test(token));
      const part = tokens.filter((token) => !/^[a-z0-9.-]+$/u.test(token));
      if (car.length === 0 || part.length === 0) return null;
      const parts = await tecdoc.liveSearch([...car, ...part].join(" ").slice(0, 120), caller);
      if (parts.length === 0) return null;
      return {
        ...(typeof first.category === "string" ? { category: first.category } : {}),
        ...(typeof first.vehicle === "string" ? { vehicle: first.vehicle } : {}),
        message: "Подходящие детали по каталогу производителей. Чтобы подобрать точно по двигателю, выберите автомобиль из списка.",
        parts: parts.slice(0, 30).map((item) => ({
          article: item.article,
          brand: item.brand,
          description: [item.name, ...item.criteria.slice(0, 2).map((criterion) => `${criterion.name}: ${criterion.value}`)].filter(Boolean).join(" · "),
          shop: item.shop,
        })),
        status: "found",
      };
    } catch {
      return null;
    }
  }

  async makes() {
    return this.run(() => this.vehicles.makes());
  }

  // The picker reads our own vehicle catalog: no visitor pays for it, so no caller is needed.
  async models(query: unknown) {
    const { make } = parse(PickerModelsQuerySchema, query);
    return this.run(() => this.vehicles.models(make));
  }

  async modifications(query: unknown) {
    const { model } = parse(PickerModificationsQuerySchema, query);
    return this.run(() => this.vehicles.modifications(model));
  }

  async suggest(query: unknown) {
    const { q } = parse(PickerSuggestQuerySchema, query);
    return { items: await this.run(() => this.vehicles.suggest(q)) };
  }

  /** The search page's «деталь + машина» hint: the car named in a request, never a paid call. */
  async understand(query: unknown) {
    const { q } = parse(VehicleUnderstandQuerySchema, query);
    return { vehicle: await this.run(() => this.vehicles.understand(q)) };
  }

  async usage(): Promise<JsonRecord> {
    return this.run(async () => ({ ...(await this.engine.usage()) }));
  }

  async staffOverview(): Promise<PartsFinderStaffOverview> {
    const [ledger, vin, supplier] = await Promise.all([
      this.engine.ledger.summary(this.engine.today()),
      this.engine.vehicles.summary(),
      this.supplierStatus(),
    ]);
    const usage = ledger.usage;
    const remaining = usage && typeof usage.remaining_credits === "number" ? usage.remaining_credits : null;
    return {
      fapi: {
        cacheEntries: ledger.cachedEntries,
        cacheHits: ledger.cacheHits,
        checkedAt: ledger.checkedAt,
        configured: Boolean(this.engine.fapiKey),
        dailyLimit: this.engine.dailyLimit,
        fitmentEnabled: this.engine.fapiFitmentEnabled,
        packageRemaining: remaining,
        visitorDailyLimit: this.engine.visitorDailyLimit,
        plan: usage && usage.plan !== undefined ? String(usage.plan) : null,
        status: usage?.status ?? null,
        usedToday: ledger.reservedToday,
      },
      supplier,
      vin: { cacheEntries: vin.entries, cacheHits: vin.hits, vinrokuRemaining: vin.vinrokuRemaining },
    };
  }

  private async guided(form: JsonRecord, payer: FapiPayer): Promise<JsonRecord> {
    const result = await this.run(() => this.engineSearch(form, payer));
    return this.enrichSearch(result, payer);
  }

  /**
   * The paid catalogue being out of credits, over its daily limit or without
   * a key is our problem, not the customer's: the search then answers from
   * the shop's own fitment and leads into the catalog section of the part.
   */
  private async engineSearch(form: JsonRecord, payer: FapiPayer): Promise<JsonRecord> {
    const vocabulary = await this.vehicles.vocabulary();
    try {
      return await this.engine.search(form, vocabulary, { payer });
    } catch (error) {
      // A visitor out of their own share of the day is answered the same way: from the shop's own data.
      if (!(error instanceof PartsFinderError) || !isCatalogueOutage(error)) throw error;
      this.logger.warn(`parts catalogue unavailable (${error.code}): answering from our own data`);
      return this.engine.search(form, vocabulary, { offline: true, payer });
    }
  }

  private async enrichSearch(result: JsonRecord, payer: FapiPayer): Promise<JsonRecord> {
    const parts = Array.isArray(result.parts) ? result.parts : null;
    const article = result.status === "article" && typeof result.article === "string" && result.article ? result.article : null;
    const requests = (parts ?? []).filter(isPart).map(partRequest);
    if (article) requests.push({ article, brand: null });
    if (requests.length === 0) return result;
    let offers = await this.shop.lookup(requests, PARTS_FINDER_OFFERS_PER_PART);
    // Nothing of ours for the fitting articles: look up the first few cards
    // (1 credit each, cached for a month), keep their crosses in our base and
    // ask our catalog again, so the customer sees what we stock instead.
    if (parts && !requests.some((request) => offers.for(request).length > 0) && await this.linkThroughCrosses(parts.filter(isPart), payer)) {
      offers = await this.shop.lookup(requests, PARTS_FINDER_OFFERS_PER_PART);
    }
    const enriched: JsonRecord = { ...result };
    if (parts) enriched.parts = rankByShop(parts.map((part) => this.withShop(part, offers)));
    if (article) enriched.shop = offers.for({ article, brand: null });
    return enriched;
  }

  /** What the supplier and FAPI know about one number, into app.article_crosses; true when anything was stored. */
  private async learnArticle(article: string, supplier: { parts: SupplierSearchResponse["parts"] } | null, payer: FapiPayer): Promise<boolean> {
    const stored = [supplier ? this.crossStore.rememberPairs(crossRowsFromSupplier(supplier.parts), "rossko") : Promise.resolve(0)];
    if (this.engine.fapiKey && await this.autoLookupBudget(1)) {
      stored.push(this.engine.crosses({ article }, payer)
        // Several brands share the number: the customer picks one under «Аналоги».
        .then((card) => (card.status === "found" ? this.crossStore.remember(card) : 0))
        .catch(() => 0));
    }
    return (await Promise.all(stored)).some((count) => count > 0);
  }

  /**
   * Paid lookups nobody clicked for are capped per hour for the whole site,
   * so a script walking part numbers cannot drain the FAPI package.
   */
  private async autoLookupBudget(cards: number): Promise<boolean> {
    try {
      await this.redis.ensureConnected();
      const key = `an30:parts-finder:auto-fapi:${Math.floor(Date.now() / 3_600_000)}`;
      const used = await this.redis.client.incrby(key, cards);
      if (used === cards) await this.redis.client.expire(key, 7_200);
      return used <= AUTO_FAPI_CARDS_PER_HOUR;
    } catch {
      return false;
    }
  }

  /** FAPI cards for the first fitting articles into app.article_crosses; true when any cross was stored. */
  private async linkThroughCrosses(parts: readonly PartRecord[], payer: FapiPayer): Promise<boolean> {
    if (!this.engine.fapiKey) return false;
    const wanted = parts.filter((part) => typeof part.manufacturer_id === "number").slice(0, AUTO_CROSS_CARDS);
    if (wanted.length === 0 || !await this.autoLookupBudget(wanted.length)) return false;
    const cards = wanted
      .map((part) => this.engine.crosses({ article: part.article, manufacturer_id: part.manufacturer_id as number }, payer)
        .then((card) => this.crossStore.remember(card))
        .catch(() => 0));
    return (await Promise.all(cards)).some((stored) => stored > 0);
  }

  /** Supplier "под заказ" offers with the shop's retail margin; never names the distributor. */
  private async supplierOffers(article: string): Promise<{ parts: SupplierSearchResponse["parts"]; totalFound: number; truncated: boolean } | null> {
    if (!this.supplierProvider.enabled || article.trim().length < 2) return null;
    try {
      const result = await this.suppliers.search({ q: article });
      await this.recordSupplier(result.success ? null : result.message);
      if (!result.success) return null;
      return { parts: result.parts, totalFound: result.totalFound, truncated: result.truncated };
    } catch (error) {
      await this.recordSupplier("Поставщик временно недоступен");
      this.logger.warn(`supplier search failed: ${error instanceof Error ? error.name : "unknown"}`);
      return null;
    }
  }

  private async recordSupplier(errorMessage: string | null): Promise<void> {
    try {
      await this.redis.ensureConnected();
      const now = new Date().toISOString();
      if (errorMessage === null) await this.redis.client.set(SUPPLIER_SUCCESS_KEY, now, "EX", 30 * 86_400);
      else await this.redis.client.set(SUPPLIER_ERROR_KEY, JSON.stringify({ at: now, message: errorMessage.slice(0, 200) }), "EX", 30 * 86_400);
    } catch {
      // Status for the staff card only; never fails a customer request.
    }
  }

  private async supplierStatus(): Promise<PartsFinderStaffOverview["supplier"]> {
    let lastError: { at: string; message: string } | null = null;
    let lastSuccessAt: string | null = null;
    try {
      await this.redis.ensureConnected();
      const [error, success] = await Promise.all([this.redis.client.get(SUPPLIER_ERROR_KEY), this.redis.client.get(SUPPLIER_SUCCESS_KEY)]);
      const parsed = error ? JSON.parse(error) as unknown : null;
      if (isRecord(parsed) && typeof parsed.at === "string" && typeof parsed.message === "string") lastError = { at: parsed.at, message: parsed.message };
      lastSuccessAt = success;
    } catch {
      // Redis down: show what is known.
    }
    return { enabled: this.supplierProvider.enabled, lastError, lastSuccessAt };
  }

  private withShop(part: unknown, offers: ShopOfferLookup): unknown {
    return isPart(part) ? { ...part, shop: offers.for(partRequest(part)) } : part;
  }

  private messageOf(error: HttpException): string {
    const response = error.getResponse();
    return isRecord(response) && typeof response.error === "string" ? response.error : PARTS_FINDER_UNAVAILABLE_MESSAGE;
  }

  /** Engine failures to stable public codes: customer-facing 4xx pass through, the rest is 503. */
  private async run<T>(work: () => Promise<T>): Promise<T> {
    if (!this.engine.enabled) {
      throw new HttpException({ code: "parts_finder_disabled", error: PARTS_FINDER_DISABLED_MESSAGE }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof PartsFinderError) {
        if (error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 403) {
          // Credits, limits and keys are staff matters (the admin card shows them).
          throw new HttpException({ code: error.code, error: isCatalogueOutage(error) ? CATALOGUE_OUTAGE_MESSAGE : error.message }, error.status);
        }
        this.logger.warn(`parts-finder ${error.status} ${error.code}`);
      } else {
        this.logger.warn(`parts-finder failure: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`);
      }
      throw new HttpException({ code: "parts_finder_unavailable", error: PARTS_FINDER_UNAVAILABLE_MESSAGE }, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
