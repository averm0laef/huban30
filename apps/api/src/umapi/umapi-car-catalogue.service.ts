import { Injectable } from "@nestjs/common";
import { normalizeBrand, type ShopOffer } from "@an30/contracts";

import { DatabaseService } from "../infrastructure/database.service.js";
import { canonicalBrand, type BrandIdentities } from "../parts-finder/parts-finder-assortment.logic.js";
import { PartsFinderShopService } from "../parts-finder/parts-finder-shop.service.js";
import {
  categoryOf, mainPartType, matchCarCategories, normalizeCarArticles, normalizeCarCatalogue, normalizePartTypes,
  type CarArticle, type CarArticlePage, type CarCatalogue, type CarPartType, type CategoryMatch,
} from "./umapi-car-catalogue.js";
import { cataloguePhotoUrls } from "./umapi-photo-archive.service.js";
import { UmapiGateway, type UmapiCaller } from "./umapi.gateway.js";
import { makerRank } from "./umapi.service.js";

/** The API gives at most 100 parts a page; a section of a popular car has up to a few hundred. */
const ARTICLES_PER_CALL = 100;
/**
 * Pages asked for one part type: 1000 parts. The catalogue lists by maker's name, so a shorter cut leaves out the
 * makers late in the alphabet (TRW, TEXTAR, NISSHINBO — 981 brake pads of an Audi A4 B8). Every page is one paid
 * call, made once a display-cache period for every visitor of that car.
 */
const MAX_ARTICLE_CALLS = 10;
const PARALLEL_PAGES = 3;
/** Parts of the general list («под заказ») a page of ours shows at once. */
export const CATALOGUE_PAGE = 30;
const SHOP_OFFERS_PER_PART = 3;
const OWN_DATA_TTL_MS = 5 * 60_000;
/** makerRank's answer for a maker outside KNOWN_MAKERS. */
const MAKER_UNKNOWN = makerRank("");

export interface CarPartView {
  article: string;
  brand: string;
  criteria: Array<{ name: string; value: string }>;
  image: string | null;
  name: string | null;
  shop: ShopOffer[];
}

export type CarCatalogueAnswer =
  | { status: "unknown_car" }
  | ({ status: "ok"; matches: CategoryMatch[] } & CarCatalogue);

export type CarPartsAnswer =
  | { status: "unknown_car" }
  | { status: "unknown_category" }
  /** The category holds several part types and none was chosen: the page offers them. */
  | { category: { id: number; name: string; path: string[] }; status: "choose_type"; types: CarPartType[] }
  | {
    brands: Array<{ count: number; name: string }>;
    catalogue: CarPartView[];
    category: { id: number; name: string; path: string[] };
    hasMore: boolean;
    ours: CarPartView[];
    page: number;
    status: "ok";
    total: number;
    /** More parts than were asked (MAX_ARTICLE_CALLS pages): the list says so. */
    truncated: boolean;
    type: CarPartType;
    types: CarPartType[];
  };

function inStockFirst(parts: CarPartView[]): CarPartView[] {
  const rank = (part: CarPartView) => (part.shop.some((offer) => offer.availableQuantity > 0) ? 0 : 1);
  return parts.map((part, index) => ({ index, part })).sort((a, b) => rank(a.part) - rank(b.part) || a.index - b.index).map(({ part }) => part);
}

/**
 * «Каталог запчастей по машине» (docs/UMAPI_INTEGRATION.md): the sections of the customer's car, the part types
 * of a section, the parts of a type — OUR products first. The car comes from our own vehicle catalog (its ids are
 * UMAPI's), so choosing it costs nothing; a section tree is one call per car, a part type one call per hundred parts,
 * each made when a visitor opens it and answered from the display cache afterwards. Nothing is written to our
 * database: the catalogue's parts are matched with our products at the moment of the answer.
 */
@Injectable()
export class UmapiCarCatalogueService {
  private identities: { at: number; value: BrandIdentities } | null = null;
  private carried: { at: number; value: Set<string> } | null = null;

  constructor(
    private readonly gateway: UmapiGateway,
    private readonly shop: PartsFinderShopService,
    private readonly database: DatabaseService,
  ) {}

  /** Our modification (vehicle catalog id) in UMAPI numbers; null for a car the catalog does not hold. */
  private async pcId(modificationId: number): Promise<number | null> {
    const found = await this.database.query<{ pc: number }>(
      "SELECT umapi_id AS pc FROM app.vehicle_catalog_modifications WHERE id=$1",
      [modificationId],
    );
    return found.rows[0]?.pc ?? null;
  }

  private tree(pc: number, caller: UmapiCaller): Promise<CarCatalogue> {
    return this.gateway.get("/Categories", { ID: pc, type: "PC" }, caller, normalizeCarCatalogue,
      { isEmpty: (value) => value.tree.length === 0, whenNotFound: { groups: [], tree: [] } });
  }

  /** The car's sections; with `query` («фильтр салона»), also the categories it names — no extra call. */
  async categories(modificationId: number, query: string | undefined, caller: UmapiCaller): Promise<CarCatalogueAnswer> {
    const pc = await this.pcId(modificationId);
    if (!pc) return { status: "unknown_car" };
    const catalogue = await this.tree(pc, caller);
    return { ...catalogue, matches: query ? matchCarCategories(catalogue.tree, query) : [], status: "ok" };
  }

  /**
   * The parts of one category for the car. Its part types first (one call); with one type — or the chosen one —
   * every page of its parts (up to MAX_ARTICLE_CALLS calls), matched with our products by number and maker (and our
   * own confirmed crosses). Ours come first and whole; the rest is paged by CATALOGUE_PAGE.
   */
  async parts(
    input: { brand?: string | undefined; categoryId: number; modificationId: number; page: number; typeId?: number | undefined },
    caller: UmapiCaller,
  ): Promise<CarPartsAnswer> {
    const pc = await this.pcId(input.modificationId);
    if (!pc) return { status: "unknown_car" };
    const sections = await this.tree(pc, caller);
    const found = categoryOf(sections.tree, input.categoryId);
    if (!found) return { status: "unknown_category" };
    const category = { id: found.node.id, name: found.node.name, path: found.path };
    const types = await this.gateway.get("/Products/one", { CATEGORY_ID: input.categoryId, ID: pc, type: "PC" }, caller, normalizePartTypes,
      { isEmpty: (value) => value.length === 0, whenNotFound: [] });
    if (types.length === 0) return { status: "unknown_category" };
    // One type, the chosen one, or the one named as the category is («Фильтр салона»): no extra question.
    const type = types.find((item) => item.id === input.typeId) ?? mainPartType(types, category.name);
    if (!type) return { category, status: "choose_type", types };

    const articles = await this.allArticles(pc, type.id, caller);
    const views = await this.withShopOffers(articles.list);
    const ours = inStockFirst(views.filter((part) => part.shop.length > 0));
    // The catalogue lists by maker's name («1A FIRST AUTOMOTIVE» first): makers customers know come first, then the
    // makers we sell, then the rest — each in the catalogue's own order.
    const carried = await this.carriedBrands();
    const rank = (brand: string) => {
      const known = makerRank(brand);
      return known !== MAKER_UNKNOWN ? known : carried.has(normalizeBrand(brand)) ? MAKER_UNKNOWN : MAKER_UNKNOWN + 1;
    };
    const rest = views.filter((part) => part.shop.length === 0)
      .map((part, index) => ({ index, part, rank: rank(part.brand) }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map(({ part }) => part);
    const counts = new Map<string, number>();
    for (const part of rest) counts.set(part.brand, (counts.get(part.brand) ?? 0) + 1);
    const brands = [...counts.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([name, count]) => ({ count, name }));
    const wanted = input.brand ? normalizeBrand(input.brand) : null;
    const filtered = wanted ? rest.filter((part) => normalizeBrand(part.brand) === wanted) : rest;
    const page = Math.max(1, input.page);
    const catalogue = filtered.slice((page - 1) * CATALOGUE_PAGE, page * CATALOGUE_PAGE);
    return {
      brands, catalogue, category, hasMore: filtered.length > page * CATALOGUE_PAGE, ours, page, status: "ok",
      total: articles.total, truncated: articles.total > articles.list.length, type, types,
    };
  }

  private async allArticles(pc: number, typeId: number, caller: UmapiCaller): Promise<{ list: CarArticle[]; total: number }> {
    const page = (offset: number) => this.gateway.get("/Articles", {
      Criterias: true, ID: pc, Info: false, limit: ARTICLES_PER_CALL, Medias: true, offset, Products: false, PT_IDS: typeId, Superseded: false, type: "PC",
    }, caller, normalizeCarArticles, { isEmpty: (value: CarArticlePage) => value.articles.length === 0, whenNotFound: { articles: [], total: 0 } });
    const first = await page(0);
    const calls = Math.min(MAX_ARTICLE_CALLS, Math.ceil(first.total / ARTICLES_PER_CALL));
    // Three pages at a time: ten at once could meet the provider's rate limit, and a refusal pauses the catalogue.
    const more: CarArticlePage[] = [];
    const offsets = Array.from({ length: Math.max(0, calls - 1) }, (_, index) => (index + 1) * ARTICLES_PER_CALL);
    for (let start = 0; start < offsets.length; start += PARALLEL_PAGES) {
      more.push(...await Promise.all(offsets.slice(start, start + PARALLEL_PAGES).map((offset) => page(offset)
        // One page failing must not hide the others: our own limits and a missing key still stop everything.
        .catch(() => ({ articles: [], total: first.total }) as CarArticlePage))));
    }
    const seen = new Set<number>();
    const list = [first, ...more].flatMap((item) => item.articles).filter((article) => (seen.has(article.artId) ? false : (seen.add(article.artId), true)));
    return { list, total: first.total };
  }

  private async withShopOffers(articles: readonly CarArticle[]): Promise<CarPartView[]> {
    if (articles.length === 0) return [];
    const [found, identities] = await Promise.all([
      this.shop.lookup(articles.map((article) => ({ article: article.article, brand: article.brand })), SHOP_OFFERS_PER_PART),
      this.brandIdentities(),
    ]);
    const base = this.gateway.mediaBaseUrl;
    return articles.map((article) => {
      const wanted = canonicalBrand(article.brand, identities);
      // The same number of another maker is another part: an exact match counts only with the same maker.
      const shop = found.for({ article: article.article, brand: article.brand })
        .filter((offer) => offer.matchedVia !== "exact" || (offer.brand !== null && canonicalBrand(offer.brand, identities) === wanted));
      return {
        article: article.article, brand: article.brand, criteria: article.criteria, image: base ? cataloguePhotoUrls(article.medias, base)[0] ?? null : null,
        name: article.name, shop: shop.slice(0, SHOP_OFFERS_PER_PART),
      };
    });
  }

  /** Makers we sell (normalized), from our own products. */
  private async carriedBrands(): Promise<Set<string>> {
    if (!this.carried || Date.now() - this.carried.at > OWN_DATA_TTL_MS) {
      const result = await this.database.query<{ name: string }>(
        `SELECT DISTINCT brand.name FROM app.products AS product JOIN app.brands AS brand ON brand.id=product.brand_id
         WHERE product.is_active AND product.deleted_at IS NULL AND brand.is_active AND brand.deleted_at IS NULL`,
      ).catch(() => ({ rows: [] as Array<{ name: string }> }));
      this.carried = { at: Date.now(), value: new Set(result.rows.map((row) => normalizeBrand(row.name))) };
    }
    return this.carried.value;
  }

  private async brandIdentities(): Promise<BrandIdentities> {
    if (!this.identities || Date.now() - this.identities.at > OWN_DATA_TTL_MS) {
      const result = await this.database.query<{ alias: string; canonical: string }>("SELECT alias,canonical FROM app.brand_identities");
      this.identities = { at: Date.now(), value: new Map(result.rows.map((row) => [row.alias, row.canonical])) };
    }
    return this.identities.value;
  }
}
