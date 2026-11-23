import { Injectable, Logger } from "@nestjs/common";
import { normalizeArticleNumber, umapiCatalogueApplies, type ShopOffer } from "@an30/contracts";

import { VISIBLE_CATEGORIES_CTE } from "../catalog/catalog-visibility.sql.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { PartsFinderShopService, type ShopOfferRequest } from "../parts-finder/parts-finder-shop.service.js";
import { combinedVerdict, groupCars, verdictFor, type FitMake, type UmapiCar, type UmapiVerdict } from "./umapi-fitment.js";
import { partCandidates, sameMaker, type PartCandidate } from "./umapi-identify.js";
import {
  normalizeArticleRows, normalizeBrandRows, normalizeCarLinks, normalizeCrossInfo, type UmapiArticleRow, type UmapiBrandRow, type UmapiCarLink, type UmapiCrossInfo,
} from "./umapi-normalize.js";
import { cataloguePhotoUrls, UmapiPhotoArchiveService } from "./umapi-photo-archive.service.js";
import { UmapiGateway, type UmapiCaller } from "./umapi.gateway.js";

/** A catalogue part our product was matched to, and how. */
export interface UmapiPart {
  article: string;
  artId: number;
  brand: string;
  /** The number it was found by (ours or from the name), as asked: the same question is then answered from the cache. */
  asked: string;
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
const SHOP_OFFERS_PER_ANALOG = 2;
const MAX_ANALOG_OFFERS = 24;

interface ResolvedPart { part: UmapiPart; info: UmapiCrossInfo }

interface ProductRow { brand: string | null; id: string; name: string; section: string | null; sku: string }

/**
 * Our products against the UMAPI catalogue, each a visitor's button (docs/UMAPI_INTEGRATION.md): does a part fit
 * the customer's car, which cars it fits, which of OUR products are its analogs, what it looks like. Answers are
 * matched with our own data at that moment. Exact photo matches enter a separate staff archive for 1С.
 */
@Injectable()
export class UmapiService {
  private readonly logger = new Logger(UmapiService.name);
  constructor(
    private readonly gateway: UmapiGateway,
    private readonly database: DatabaseService,
    private readonly shop: PartsFinderShopService,
    private readonly archive: UmapiPhotoArchiveService,
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

  private articlesOf(article: string, brand: string, caller: UmapiCaller, fresh = false): Promise<UmapiArticleRow[]> {
    return this.gateway.get(`/Analogs/${encodeURIComponent(article)}/${encodeURIComponent(brand)}`, { limit: ANALOG_ROWS }, caller, normalizeArticleRows,
      { fresh, isEmpty: (list) => list.length === 0, whenNotFound: [] });
  }

  /**
   * The catalogue part for one number: the maker as UMAPI writes it (BrandRefinement — only its makers' own numbers,
   * «ArticleNumber»; the others are other makers' crosses), then the part's catalogue id (getCrossInfo). A number
   * without a maker counts only when UMAPI knows a single maker for it.
   */
  private async resolve(candidate: PartCandidate, caller: UmapiCaller, fresh: boolean): Promise<ResolvedPart | "ambiguous" | null> {
    // UMAPI is asked with the bare number: «W 914/2» as «W9142» (a «/» in the address breaks the path; checked 23.11.2026).
    const number = normalizeArticleNumber(candidate.article);
    if (number.length < 3) return null;
    const all = await this.brandsOf(number, caller, fresh);
    const own = all.filter((row) => row.type === "ArticleNumber");
    const brands = own.length > 0 ? own : all;
    let brand: string | undefined;
    if (candidate.brand) {
      brand = brands.find((row) => sameMaker(row.brand, candidate.brand!))?.brand;
    } else {
      const makers = [...new Set(brands.map((row) => row.brand))];
      if (makers.length > 1) return "ambiguous";
      brand = makers[0];
    }
    if (!brand) return null;
    const info = await this.crossInfo(number, brand, caller, fresh);
    if (!info || normalizeArticleNumber(info.article) !== number || !sameMaker(info.brand, brand)) return null;
    return { info, part: { article: info.article, artId: info.artId, asked: number, brand: info.brand, via: candidate.via } };
  }

  /** Our own number decides alone; without it, the analogue numbers in the name (at most three). */
  private async identify(product: ProductRow, caller: UmapiCaller, fresh = false): Promise<ResolvedPart[] | "ambiguous" | null> {
    const [own, ...named] = partCandidates(product);
    const ownPart = await this.resolve(own!, caller, fresh);
    if (ownPart && ownPart !== "ambiguous") return [ownPart];
    const parts: ResolvedPart[] = [];
    for (const candidate of named) {
      const part = await this.resolve(candidate, caller, fresh);
      if (part && part !== "ambiguous") parts.push(part);
    }
    if (parts.length > 0) return parts;
    return ownPart === "ambiguous" ? "ambiguous" : null;
  }

  private async checkable(productId: string): Promise<ProductRow | UmapiProductAnswer> {
    const product = await this.product(productId);
    if (!product) return { status: "not_found" };
    if (!umapiCatalogueApplies(product)) return { status: "not_applicable" };
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

  /** Every press uses a fresh catalogue response. The private archive has no role in the public response. */
  async productPhotos(productId: string, caller: UmapiCaller): Promise<UmapiProductAnswer | { status: "not_available" } | { part: UmapiPart; photos: string[]; status: "ok" | "none" }> {
    const base = this.gateway.mediaBaseUrl;
    if (!base) return { status: "not_available" };
    const product = await this.checkable(productId);
    if ("status" in product) return product;
    const identified = await this.identify(product, caller, true);
    if (identified === "ambiguous") return { status: "ambiguous" };
    if (!identified) return { status: "unknown_part" };
    const { info, part } = identified[0]!;
    const photos = cataloguePhotoUrls(info.medias, base);
    if (photos.length > 0 && part.via === "own" && product.brand && sameMaker(product.brand, part.brand)) {
      await this.archive.remember({ ...product, brand: product.brand }, part, photos).catch(() => {
        this.logger.warn("Could not record UMAPI photo references for staff");
      });
    }
    return { part, photos, status: photos.length > 0 ? "ok" : "none" };
  }
}
