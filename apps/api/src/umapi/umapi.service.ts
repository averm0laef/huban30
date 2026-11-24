import { Injectable, Logger } from "@nestjs/common";
import { normalizeArticleNumber, umapiCatalogueApplies, umapiPhotoApplies, type ShopOffer } from "@an30/contracts";

import { VISIBLE_CATEGORIES_CTE } from "../catalog/catalog-visibility.sql.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { PartsFinderCrossStore } from "../parts-finder/parts-finder-crosses.store.js";
import { PartsFinderShopService, type ShopOfferRequest } from "../parts-finder/parts-finder-shop.service.js";
import { combinedVerdict, groupCars, verdictFor, type FitMake, type UmapiCar, type UmapiVerdict } from "./umapi-fitment.js";
import { makerByPartKind, makerNamedIn, partCandidates, sameMaker, type PartCandidate } from "./umapi-identify.js";
import {
  normalizeArticleCard, normalizeArticleRows, normalizeBrandRows, normalizeCarLinks, normalizeCrossInfo, type UmapiArticleCard, type UmapiArticleRow,
  type UmapiBrandRow, type UmapiCarLink, type UmapiCrossInfo, type UmapiSpec,
} from "./umapi-normalize.js";
import { cataloguePhotoUrls, UmapiPhotoArchiveService } from "./umapi-photo-archive.service.js";
import { UmapiProductCardService } from "./umapi-product-card.service.js";
import { UmapiGateway, type UmapiCaller } from "./umapi.gateway.js";

/** A catalogue part our product was matched to, and how. */
export interface UmapiPart {
  article: string;
  artId: number;
  brand: string;
  /** The number it was found by (ours or from the name), as asked: the same question is then answered from the cache. */
  asked: string;
  /**
   * Set when the part is an analogue of the number we looked up, not that number itself: an original number
   * («TOYOTA 23300-31090» behind SAT's «ST-23300-31090») or a maker the catalogue has no card of (MASUMA). Its cars
   * and photo are those of the analogue, and the page says so.
   */
  through?: { article: string; brand: string };
  via: "own" | "name";
}

export type UmapiProductAnswer =
  /** No such product a customer can open. */
  | { status: "not_found" }
  /** Oils, fluids, tools, a number too short: the catalogue is never asked. */
  | { status: "not_applicable" }
  /** No number of ours or in the name leads to a catalogue part. */
  | { status: "unknown_part" }
  /** Our number without a maker belongs to several makers in the catalogue. */
  | { status: "ambiguous" };

/** «Показать фото и характеристики»: what the catalogue holds of the part (`none`: neither a photo nor characteristics). */
export interface UmapiPhotoAnswer { part: UmapiPart; photos: string[]; specs: UmapiSpec[]; status: "ok" | "none"; title: string | null }

export type UmapiFitmentAnswer = UmapiProductAnswer
  /** A check asked without a chosen car: the page asks to choose one. */
  | { status: "vehicle_required" }
  | {
    makes: FitMake[];
    parts: Array<UmapiPart & { verdict: UmapiVerdict | null }>;
    status: "ok";
    total: number;
    /** null in a list; for a check, null means the analogue numbers disagree: «не уверены». */
    verdict: UmapiVerdict | null;
    via: "own" | "name";
  };

const ANALOG_ROWS = 100;
/** Analogues whose cars stand in for a number without a card of its own: enough for a full list, few calls. */
const STAND_INS = 3;
/** Makers whose analogue stands in first: known to customers, with full cards and photos in the catalogue. */
const KNOWN_MAKERS = [
  "BOSCH", "MANNFILTER", "MAHLE", "KNECHT", "FILTRON", "HENGSTFILTER", "TRW", "ATE", "BREMBO", "TEXTAR", "FEBEST", "MASUMA", "JSASAKASHI",
  "SAKURA", "BLUEPRINT", "KYB", "SACHS", "LEMFORDER", "FEBIBILSTEIN", "MEYLE", "SKF", "NTN", "SNR", "JTEKTKOYO", "NSK", "DENSO", "NGK",
  "CTR", "555", "GATES", "DAYCO", "CONTINENTALCTAM", "AISIN", "EXEDY", "VALEO", "LUK", "NISSHINBO", "AKEBONO", "SANGSIN", "LYNXAUTO",
];
/** Where a maker stands among KNOWN_MAKERS (their number when not among them): known makers are listed first. */
export function makerRank(brand: string): number {
  const index = KNOWN_MAKERS.findIndex((known) => sameMaker(known, brand));
  return index === -1 ? KNOWN_MAKERS.length : index;
}
const SHOP_OFFERS_PER_ANALOG = 2;
/** The same part's analogs are written to the cross base at most this often (the display cache answers between). */
const KEEP_CROSSES_EVERY_MS = 60 * 60_000;
const MAX_ANALOG_OFFERS = 24;

/** `info` (the card with photos) is known for an exact match; for an analogue stand-in it is asked only for a photo. */
interface ResolvedPart { part: UmapiPart; info: UmapiCrossInfo | null }

interface ProductRow { brand: string | null; id: string; name: string; section: string | null; sku: string }

/**
 * Our products against the UMAPI catalogue, each a visitor's button (docs/UMAPI_INTEGRATION.md): does a part fit
 * the customer's car, which cars it fits, which of OUR products are its analogs, what it looks like. Answers are
 * matched with our own data at that moment. Exact photo matches enter a separate staff archive for 1С.
 */
@Injectable()
export class UmapiService {
  private readonly logger = new Logger(UmapiService.name);
  private readonly keptCrosses = new Map<string, number>();
  constructor(
    private readonly gateway: UmapiGateway,
    private readonly database: DatabaseService,
    private readonly shop: PartsFinderShopService,
    private readonly archive: UmapiPhotoArchiveService,
    private readonly cards: UmapiProductCardService,
    private readonly crosses: PartsFinderCrossStore,
  ) {}

  /** What the product page may offer: the buttons, and the photo button only when the photo address is known. */
  status(): { enabled: boolean; photos: boolean } {
    return { enabled: this.gateway.available, photos: this.gateway.available && this.gateway.mediaBaseUrl !== null };
  }

  /* ---------------- Which catalogue part a product is ---------------- */

  private async product(productId: string): Promise<ProductRow | null> {
    const found = await this.database.query<ProductRow>(
      // Only a product a customer can open: one in a hidden section is answered as «not found», like its page.
      `${VISIBLE_CATEGORIES_CTE}
       SELECT product.id::text AS id,product.sku::text AS sku,product.name,brand.name AS brand,COALESCE(parent.slug,category.slug)::text AS section
       FROM app.products AS product
       LEFT JOIN app.brands AS brand ON brand.id=product.brand_id AND brand.is_active AND brand.deleted_at IS NULL
       LEFT JOIN app.categories AS category ON category.id=product.category_id
       LEFT JOIN app.categories AS parent ON parent.id=category.parent_id
       WHERE product.id=$1 AND product.is_active AND product.deleted_at IS NULL
         AND (product.category_id IS NULL OR category.id IN (SELECT id FROM visible_categories))`,
      [productId],
    );
    return found.rows[0] ?? null;
  }

  private brandsOf(article: string, caller: UmapiCaller, fresh: boolean): Promise<UmapiBrandRow[]> {
    return this.gateway.get(`/BrandRefinement/${encodeURIComponent(article)}`, {}, caller, normalizeBrandRows, { fresh, isEmpty: (list) => list.length === 0, whenNotFound: [] });
  }

  private crossInfo(article: string, brand: string, caller: UmapiCaller, fresh: boolean): Promise<UmapiCrossInfo | null> {
    return this.gateway.get("/v2/cross/parts/Analogs/getCrossInfo", { article, brand }, caller, normalizeCrossInfo, { fresh, isEmpty: (info) => info === null, whenNotFound: null });
  }

  private async articlesOf(article: string, brand: string, caller: UmapiCaller, fresh = false): Promise<UmapiArticleRow[]> {
    const rows = await this.gateway.get(`/Analogs/${encodeURIComponent(article)}/${encodeURIComponent(brand)}`, { limit: ANALOG_ROWS }, caller, normalizeArticleRows,
      { fresh, isEmpty: (list) => list.length === 0, whenNotFound: [] });
    this.keepCrosses(article, brand, rows);
    return rows;
  }

  /**
   * Every analog answer grows the shop's own cross base (owner, 24.11.2026; migration 0063): «the part ↔ each
   * analog», unconfirmed. A pair another source names too is confirmed by the database's merge rule. Written once
   * an hour per part at most, never awaited: a press is never slowed or failed by it.
   */
  private keepCrosses(article: string, brand: string, rows: readonly UmapiArticleRow[]): void {
    if (rows.length === 0) return;
    const key = `${brand.toUpperCase()}|${normalizeArticleNumber(article)}`;
    const now = Date.now();
    if ((this.keptCrosses.get(key) ?? 0) > now - KEEP_CROSSES_EVERY_MS) return;
    if (this.keptCrosses.size > 5_000) this.keptCrosses.clear();
    this.keptCrosses.set(key, now);
    const pairs = rows.filter((row) => !(normalizeArticleNumber(row.article) === normalizeArticleNumber(article) && sameMaker(row.brand, brand)))
      .map((row) => ({ article, brand, confirmed: false, crossArticle: row.article, crossBrand: row.brand }));
    void this.crosses.rememberPairs(pairs, "umapi").catch(() => undefined);
  }

  /**
   * The catalogue part for one number (docs/UMAPI_INTEGRATION.md, part 4):
   * 1. whose number it is — BrandRefinement, the makers' own numbers («ArticleNumber»; the rest are crosses). With
   *    our maker, that maker; without one, the only maker, or the one the product's name mentions;
   * 2. its card — getCrossInfo, the catalogue id and the photos;
   * 3. no card (the catalogue knows the number only as an original one, «OENumber», or knows the maker but has no
   *    card of it): the number's analogues stand in for it, at most three, each with its own card.
   */
  private async resolve(candidate: PartCandidate, product: ProductRow, caller: UmapiCaller, fresh: boolean): Promise<ResolvedPart[] | "ambiguous" | null> {
    // UMAPI is asked with the bare number: «W 914/2» as «W9142» (a «/» in the address breaks the path; checked 23.11.2026).
    const number = normalizeArticleNumber(candidate.article);
    if (number.length < 3) return null;
    const all = await this.brandsOf(number, caller, fresh);
    const makers = [...new Set(all.filter((row) => row.type === "ArticleNumber").map((row) => row.brand))];
    // A number of the name is first the product's own number written in full («AVX13X1385 … Contitech»).
    const ours = candidate.brand ?? (candidate.via === "name" ? product.brand : null);
    let brand: string | undefined = ours ? makers.find((maker) => sameMaker(maker, ours)) : undefined;
    if (brand) {
      // found by our maker
    } else if (makers.length > 0 && candidate.brand) {
      // Our maker has no such number: another maker's same number is another part.
      return null;
    } else if (makers.length === 1) {
      brand = makers[0];
    } else if (makers.length > 1) {
      brand = makerNamedIn(product.name, makers)
        ?? makerByPartKind(product.name, all.filter((row) => row.type === "ArticleNumber")) ?? undefined;
      if (!brand) return "ambiguous";
    } else {
      // No maker's own number: an original number of a car maker («TOYOTA 23300-31090», NOK's «90311-48009»), or
      // another maker's cross of it. The parts made to it stand in for it.
      const original = [...new Set(all.filter((row) => row.type === "OENumber").map((row) => row.brand))];
      const crosses = [...new Set(all.map((row) => row.brand))];
      const maker = makerNamedIn(product.name, original) ?? original[0] ?? (crosses.length === 1 ? crosses[0] : undefined);
      return maker ? this.standIns(number, maker, candidate, caller, fresh) : null;
    }
    if (!brand) return null;
    const info = await this.crossInfo(number, brand, caller, fresh);
    if (info && normalizeArticleNumber(info.article) === number && sameMaker(info.brand, brand)) {
      return [{ info, part: { article: info.article, artId: info.artId, asked: number, brand: info.brand, via: candidate.via } }];
    }
    // The catalogue knows the maker's number but keeps no card of it (MASUMA, many Asian makers).
    return this.standIns(number, brand, candidate, caller, fresh);
  }

  /** Up to three analogues of a number that has no card of its own, each a part with its own card id. */
  private async standIns(number: string, maker: string, candidate: PartCandidate, caller: UmapiCaller, fresh: boolean): Promise<ResolvedPart[] | null> {
    const rows = [...await this.articlesOf(number, maker, caller, fresh)]
      // Makers a customer knows first (their photo and list are the ones to show), then the catalogue's order.
      .sort((a, b) => makerRank(a.brand) - makerRank(b.brand));
    const seen = new Set<number>();
    const parts: ResolvedPart[] = [];
    for (const row of rows) {
      if (seen.has(row.artId)) continue;
      seen.add(row.artId);
      parts.push({
        info: null,
        part: { article: row.article, artId: row.artId, asked: normalizeArticleNumber(row.article), brand: row.brand, through: { article: candidate.article, brand: maker }, via: candidate.via },
      });
      if (parts.length >= STAND_INS) break;
    }
    return parts.length > 0 ? parts : null;
  }

  /**
   * Our own number decides alone (it may be several stand-in analogues of it); without it, the numbers of the name,
   * at most three.
   */
  private async identify(product: ProductRow, caller: UmapiCaller, fresh = false): Promise<ResolvedPart[] | "ambiguous" | null> {
    const candidates = partCandidates(product);
    let ambiguous = false;
    for (const candidate of candidates.filter((item) => item.via === "own")) {
      const found = await this.resolve(candidate, product, caller, fresh);
      if (found === "ambiguous") ambiguous = true;
      else if (found) return found;
    }
    const parts: ResolvedPart[] = [];
    for (const candidate of candidates.filter((item) => item.via === "name")) {
      const found = await this.resolve(candidate, product, caller, fresh);
      if (found === "ambiguous") ambiguous = true;
      // A name number standing in through analogues counts as one answer: its first analogue.
      else if (found) parts.push(...(found[0]!.part.through ? [found[0]!] : found));
    }
    if (parts.length > 0) return parts;
    return ambiguous ? "ambiguous" : null;
  }

  /** `photo`: the photo button, which also serves the few oils and fluids the catalogue has (umapiPhotoApplies). */
  private async checkable(productId: string, purpose: "fitment" | "photo" = "fitment"): Promise<ProductRow | UmapiProductAnswer> {
    const product = await this.product(productId);
    if (!product) return { status: "not_found" };
    if (!(purpose === "photo" ? umapiPhotoApplies(product) : umapiCatalogueApplies(product))) return { status: "not_applicable" };
    return product;
  }

  /* ---------------- Compatibility ---------------- */

  /** The customer's car in UMAPI numbers, from our vehicle catalog (its ids are those of the UMAPI file). */
  private async car(input: { modelId?: number; modificationId?: number }): Promise<UmapiCar | null> {
    if (input.modificationId) {
      const found = await this.database.query<{ ms: number; pc: number }>(
        `SELECT modification.umapi_id AS pc,model.umapi_id AS ms FROM app.vehicle_catalog_modifications AS modification
         JOIN app.vehicle_catalog_models AS model ON model.id=modification.model_id WHERE modification.id=$1`,
        [input.modificationId],
      );
      const row = found.rows[0];
      if (row) return { msId: row.ms, pcId: row.pc };
    }
    if (input.modelId) {
      const found = await this.database.query<{ ms: number }>("SELECT umapi_id AS ms FROM app.vehicle_catalog_models WHERE id=$1", [input.modelId]);
      if (found.rows[0]) return { msId: found.rows[0].ms, pcId: null };
    }
    return null;
  }

  /**
   * Two buttons of the product page, nothing on its opening: `check` — does it fit the customer's car; `list` —
   * which cars it fits. BrandRefinement + Analogs + ArticleLinks: three calls for a first question about a product,
   * none for the same question within the display cache's lifetime.
   */
  async productFitment(productId: string, input: { modelId?: number; modificationId?: number }, caller: UmapiCaller, mode: "check" | "list"): Promise<UmapiFitmentAnswer> {
    const product = await this.checkable(productId);
    if ("status" in product) return product;
    const car = await this.car(input);
    if (mode === "check" && !car) return { status: "vehicle_required" };
    const identified = await this.identify(product, caller);
    if (identified === "ambiguous") return { status: "ambiguous" };
    if (!identified) return { status: "unknown_part" };
    const links = await Promise.all(identified.map(({ part }) =>
      this.gateway.get(`/ArticleLinks/${part.artId}`, {}, caller, normalizeCarLinks, { isEmpty: (list) => list.length === 0, whenNotFound: [] })));
    const parts = identified.map(({ part }, index) => ({ ...part, verdict: car ? verdictFor(links[index]!, car) : null }));
    const via = identified[0]!.part.via;
    if (mode === "check") {
      return { makes: [], parts, status: "ok", total: 0, verdict: combinedVerdict(parts.map((part) => ({ verdict: part.verdict!, via: part.via }))), via };
    }
    const all: UmapiCarLink[] = links.flat();
    const { makes, total } = groupCars(all, car ?? { msId: null, pcId: null });
    return { makes, parts, status: "ok", total, verdict: null, via };
  }

  /* ---------------- Analogs we sell ---------------- */

  /**
   * «Найти ещё аналоги в каталоге»: UMAPI's analogs of the part, matched against our products by number and maker,
   * in memory. Only our products are returned; the catalogue's list itself is neither shown nor kept.
   */
  async productAnalogs(productId: string, caller: UmapiCaller): Promise<UmapiProductAnswer | { offers: ShopOffer[]; parts: UmapiPart[]; status: "ok" }> {
    const product = await this.checkable(productId);
    if ("status" in product) return product;
    const identified = await this.identify(product, caller);
    if (identified === "ambiguous") return { status: "ambiguous" };
    if (!identified) return { status: "unknown_part" };
    const rows = (await Promise.all(identified.map(({ part }) => this.articlesOf(part.asked, part.brand, caller)))).flat();
    const requests: ShopOfferRequest[] = rows.map((row) => ({ article: row.article, brand: row.brand }));
    const lookup = await this.shop.lookup(requests, SHOP_OFFERS_PER_ANALOG);
    const seen = new Set<string>([product.id]);
    const offers: ShopOffer[] = [];
    for (const row of rows) {
      for (const offer of lookup.for({ article: row.article, brand: row.brand })) {
        // The same number of another maker is another part: only the number AND the maker make it this analog.
        if (offer.matchedVia !== "exact" || !offer.brand || !sameMaker(offer.brand, row.brand) || seen.has(offer.productId)) continue;
        seen.add(offer.productId);
        offers.push({ ...offer, basis: "catalogue" });
      }
    }
    offers.sort((a, b) => Number(b.availableQuantity > 0) - Number(a.availableQuantity > 0) || (a.priceKopeks ?? Infinity) - (b.priceKopeks ?? Infinity));
    return { offers: offers.slice(0, MAX_ANALOG_OFFERS), parts: identified.map(({ part }) => part), status: "ok" };
  }

  /** «Самостоятельный подбор»: candidates belong to their own number and every shop offer matches both fields. */
  async numberAnalogs(article: string, brand: string | undefined, caller: UmapiCaller) {
    const number = normalizeArticleNumber(article);
    const empty = { article, status: "no_data" as const };
    if (number.length < 3) return empty;
    const brands = await this.brandsOf(number, caller, true);
    const exact = brands.filter((entry) => entry.type === "ArticleNumber" && normalizeArticleNumber(entry.article) === number);
    const makers = [...new Set(exact.map((entry) => entry.brand))];
    if (!brand && makers.length > 1) {
      return { article, candidates: makers.map((maker) => ({ article, brand: maker })), status: "choose_brand" as const };
    }
    const maker = brand ? makers.find((value) => sameMaker(brand, value)) : makers[0];
    if (!maker) return empty;

    const seen = new Set<string>();
    const crossRows = (await this.articlesOf(number, maker, caller, true)).filter((row) => {
      const crossNumber = normalizeArticleNumber(row.article);
      const key = `${row.brand.toUpperCase()}:${crossNumber}`;
      if (seen.has(key) || (crossNumber === number && sameMaker(row.brand, maker))) return false;
      seen.add(key);
      return true;
    });
    if (crossRows.length === 0) return empty;
    const lookup = await this.shop.lookup(crossRows, SHOP_OFFERS_PER_ANALOG);
    const analogs = crossRows.map(({ article: crossArticle, brand: crossBrand }) => ({
      article: crossArticle,
      brand: crossBrand,
      shop: lookup.for({ article: crossArticle, brand: crossBrand })
        .filter((offer) => offer.matchedVia === "exact" && offer.brand && sameMaker(offer.brand, crossBrand)),
    }));
    return { article, groups: { analogs }, status: "found" as const };
  }

  /* ---------------- Photo ---------------- */

  /**
   * «Показать фото и характеристики»: the maker's photos and characteristics of the part. Every press uses a fresh
   * identification. When the catalogue named this very part (our number, not an analogue standing in for it), the
   * answer is kept for the product (migration 0062): from then on the catalogue lists show its small photo and the
   * page shows it at once. An analogue's photo is shown as such and never kept.
   */
  async productPhotos(productId: string, caller: UmapiCaller): Promise<UmapiProductAnswer | { status: "not_available" } | UmapiPhotoAnswer> {
    const base = this.gateway.mediaBaseUrl;
    if (!base) return { status: "not_available" };
    const product = await this.checkable(productId, "photo");
    if ("status" in product) return product;
    const identified = await this.identify(product, caller, true);
    if (identified === "ambiguous") return { status: "ambiguous" };
    if (!identified) return { status: "unknown_part" };
    // The first part with a photo: an analogue stand-in has its card asked only now.
    let part = identified[0]!.part;
    let photos: string[] = [];
    let title: string | null = identified[0]!.info?.title ?? null;
    for (const found of identified.slice(0, STAND_INS)) {
      const info = found.info ?? await this.crossInfo(found.part.asked, found.part.brand, caller, false);
      photos = info ? cataloguePhotoUrls(info.medias, base) : [];
      part = found.part;
      title = info?.title ?? title;
      if (photos.length > 0) break;
    }
    // The maker's characteristics, for the product's own part only: an analogue's sizes may differ.
    const card: UmapiArticleCard = part.through
      ? { specs: [], title: null }
      : await this.gateway.get(`/Article/${part.artId}`, { Criterias: true }, caller, normalizeArticleCard, { whenNotFound: { specs: [], title: null } })
        .catch(() => ({ specs: [], title: null }));
    const own = { part, photos, specs: card.specs, status: photos.length > 0 || card.specs.length > 0 ? "ok" as const : "none" as const, title: card.title ?? title };
    // The part is known but its maker's card has no picture (KYB-AU 551112, KOYO 62102RSCM — 9 of 300 products,
    // 24.11.2026): an analogue's photo, shown as such, with this part's own characteristics. Never kept as ours.
    let answer: UmapiPhotoAnswer = own;
    if (photos.length === 0 && !part.through) {
      const analogues = await this.standIns(part.asked, part.brand, { article: part.article, brand: part.brand, via: part.via }, caller, false).catch(() => null);
      for (const found of analogues ?? []) {
        const info = await this.crossInfo(found.part.asked, found.part.brand, caller, false).catch(() => null);
        const shown = info ? cataloguePhotoUrls(info.medias, base) : [];
        if (shown.length > 0) {
          answer = { part: found.part, photos: shown, specs: card.specs, status: "ok", title: own.title };
          break;
        }
      }
    }
    if (part.via === "own" && !part.through) {
      await this.cards.keep(product, part, own).catch(() => this.logger.warn("Could not keep the maker's card of a product"));
      if (photos.length > 0 && product.brand && sameMaker(product.brand, part.brand)) {
        await this.archive.remember({ ...product, brand: product.brand }, part, photos).catch(() => {
          this.logger.warn("Could not record UMAPI photo references for staff");
        });
      }
    }
    return answer;
  }
}
