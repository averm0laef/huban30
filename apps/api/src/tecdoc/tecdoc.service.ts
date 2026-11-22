import { Injectable } from "@nestjs/common";
import { normalizeArticleNumber, normalizeBrand, partNumberCatalogueApplies, type ShopOffer } from "@an30/contracts";

import { VISIBLE_CATEGORIES_CTE } from "../catalog/catalog-visibility.sql.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { parseModelName } from "../parts-finder/engine/model-name.js";
import { VEHICLE_SEED } from "../parts-finder/engine/vehicle-seed.js";
import { canonicalBrand, type BrandIdentities } from "../parts-finder/parts-finder-assortment.logic.js";
import { PartsFinderShopService, type ShopOfferRequest } from "../parts-finder/parts-finder-shop.service.js";
import { popularFamilies } from "../parts-finder/parts-finder-vehicles.service.js";
import {
  collectGenerationIds, hasMorePages, matchCategories, normalizeCategories, normalizeGenerations, normalizeMakes, normalizeModels,
  normalizePartDetail, normalizeParts, normalizeSeries, normalizeSupplierRows, normalizeVin,
  type CategoryMatch, type TecdocCategory, type TecdocFitmentMake, type TecdocMake, type TecdocOem, type TecdocPart,
} from "./tecdoc-normalize.js";
import { TecdocError, TecdocGateway, type TecdocCaller } from "./tecdoc.gateway.js";

export interface TecdocPickerMake { country: string | null; id: number; name: string; nameRu: string | null; slug: string }
export interface TecdocPickerModel {
  body: string | null; family: string; fapi: true; generation: string | null; id: number; name: string; yearFrom: number | null; yearTo: number | null;
}
export interface TecdocPickerModification {
  body: string | null; capacity: string | null; engine: string | null; fuel: string | null; id: number; label: string;
  powerPs: number | null; yearFrom: number | null; yearTo: number | null;
}
export interface TecdocPartView {
  article: string; brand: string; criteria: Array<{ name: string; value: string }>; group: string | null; image: string | null;
  name: string; oems: TecdocOem[]; shop: ShopOffer[];
}
export type FitmentVerdict = "fits" | "model" | "other_engine" | "not_listed";

const SHOP_OFFERS_PER_PART = 3;
/** Brands of ours asked about for one car and category: each is one provider call. */
const MAX_BRAND_CALLS = 6;
const PARTS_PER_PAGE = 50;
const OWN_DATA_TTL_MS = 5 * 60_000;
const VEHICLE_TYPE = "PC";

function brandKey(name: string): string {
  return normalizeBrand(name);
}

/** "ALFA ROMEO" -> "Alfa Romeo"; short names stay capitals (BMW, VW). */
function pretty(name: string): string {
  return name.trim().replace(/[A-Za-zА-Яа-яЁё]+/gu, (word) => (word.length <= 3 ? word.toUpperCase() : word[0]!.toUpperCase() + word.slice(1).toLowerCase()));
}

const SEED_BY_KEY = new Map(VEHICLE_SEED.map((seed) => [brandKey(seed.name), seed]));

/**
 * Our offers for a catalogue part. A product found by its number alone is
 * the named part only when its brand is the part's brand too (the same
 * number under another brand is another part); offers through our own
 * confirmed crosses already carry that check.
 */
function offersOf(offers: readonly ShopOffer[], brand: string, identities: BrandIdentities): ShopOffer[] {
  const wanted = canonicalBrand(brand, identities);
  return offers.filter((offer) => offer.matchedVia !== "exact" || (offer.brand !== null && canonicalBrand(offer.brand, identities) === wanted));
}

function inStockFirst(parts: TecdocPartView[]): TecdocPartView[] {
  const rank = (part: TecdocPartView) => (part.shop.some((offer) => offer.availableQuantity > 0) ? 0 : part.shop.length > 0 ? 1 : 2);
  return parts.map((part, index) => ({ index, part })).sort((a, b) => rank(a.part) - rank(b.part) || a.index - b.index).map(({ part }) => part);
}

/**
 * TecDoc as the vehicle and applicability catalogue (docs/TECDOC.md). Every
 * method answers one visitor's request; what the provider returns is matched
 * against OUR products at that moment and is never written to our database.
 */
@Injectable()
export class TecdocService {
  private identities: { at: number; value: BrandIdentities } | null = null;
  private carried: { at: number; value: Map<string, number> } | null = null;

  constructor(
    private readonly gateway: TecdocGateway,
    private readonly shop: PartsFinderShopService,
    private readonly database: DatabaseService,
  ) {}

  get enabled(): boolean {
    return this.gateway.enabled;
  }

  /** Configured and not paused after a refusal or an outage: otherwise the site uses its own vehicle list. */
  get available(): boolean {
    return this.gateway.enabled && !this.gateway.health.paused;
  }

  /* ---------------- Vehicle picker ---------------- */

  private makeList(caller: TecdocCaller): Promise<TecdocMake[]> {
    return this.gateway.get("/manufacturer", { mfa_type: VEHICLE_TYPE }, caller, normalizeMakes, { isEmpty: (list) => list.length === 0 });
  }

  private pickerMake(make: TecdocMake): TecdocPickerMake {
    const seed = SEED_BY_KEY.get(brandKey(make.name));
    return { country: seed?.country ?? null, id: make.id, name: seed?.name ?? pretty(make.name), nameRu: seed?.nameRu ?? null, slug: String(make.id) };
  }

  async makes(caller: TecdocCaller): Promise<{ groups: Array<{ letter: string; makes: TecdocPickerMake[] }>; popular: TecdocPickerMake[] }> {
    const list = await this.makeList(caller);
    const popular = list
      .flatMap((make) => { const rank = SEED_BY_KEY.get(brandKey(make.name))?.rank; return rank ? [{ make, rank }] : []; })
      .sort((a, b) => a.rank - b.rank)
      .map(({ make }) => this.pickerMake(make));
    const groups = new Map<string, TecdocPickerMake[]>();
    for (const make of list.map((item) => this.pickerMake(item)).sort((a, b) => a.name.localeCompare(b.name, "ru", { sensitivity: "base" }))) {
      const first = make.name[0]?.toUpperCase() ?? "#";
      const letter = /[0-9]/u.test(first) ? "0–9" : first;
      groups.set(letter, [...(groups.get(letter) ?? []), make]);
    }
    return { groups: [...groups.entries()].map(([letter, makes]) => ({ letter, makes })), popular };
  }

  /** A make's models: each is one generation (body) of a model family, grouped by the catalogue's own series. */
  async models(makeId: number, caller: TecdocCaller) {
    const [series, models, makes] = await Promise.all([
      this.gateway.get("/series", { mfa_id: makeId, mfa_type: VEHICLE_TYPE }, caller, normalizeSeries).catch((error: unknown) => {
        // Grouping still works from the names alone.
        if (error instanceof TecdocError && error.failure === "unavailable") return [];
        throw error;
      }),
      this.gateway.get("/model", { mfa_id: makeId, mfa_type: VEHICLE_TYPE }, caller, normalizeModels, { isEmpty: (list) => list.length === 0 }),
      this.makeList(caller),
    ]);
    const make = makes.find((item) => item.id === makeId);
    const seed = make ? SEED_BY_KEY.get(brandKey(make.name)) : undefined;
    const seedNames = new Map((seed?.models ?? []).map((name) => [name.toLowerCase(), name]));
    const families = [...new Set([...series.map((item) => item.name), ...(seed?.models ?? [])])];
    const list = models.map((model): TecdocPickerModel => {
      const parsed = parseModelName(model.name, families);
      return {
        body: parsed.body, family: seedNames.get(parsed.family.toLowerCase()) ?? pretty(parsed.family), fapi: true, generation: parsed.generation,
        id: model.id, name: model.name, yearFrom: model.yearFrom, yearTo: model.yearTo,
      };
    }).sort((a, b) => a.family.localeCompare(b.family, "ru", { numeric: true, sensitivity: "base" }) || (b.yearFrom ?? 0) - (a.yearFrom ?? 0));
    return {
      make: make ? this.pickerMake(make) : { country: null, id: makeId, name: "", nameRu: null, slug: String(makeId) },
      models: list,
      // "RAV4" is "RAV 4" in the catalogue, "Noah" is half of "Noah/Voxy".
      popular: popularFamilies(seed?.models ?? [], list),
      source: "tecdoc" as const,
    };
  }

  /** Engines (modifications) of one model generation. */
  async modifications(modelId: number, caller: TecdocCaller) {
    const generations = await this.gateway.get("/generation", { ms_id: modelId, mfa_type: VEHICLE_TYPE }, caller, normalizeGenerations, { isEmpty: (list) => list.length === 0 });
    const modifications = generations.map((item): TecdocPickerModification => ({
      body: item.body,
      capacity: item.capacityLiters,
      engine: item.engineCodes.slice(0, 3).join(", ") || null,
      fuel: item.fuel,
      id: item.id,
      label: [item.name, item.powerPs ? `${item.powerPs} л.с.` : null, item.fuel].filter(Boolean).join(" · "),
      powerPs: item.powerPs,
      yearFrom: item.yearFrom,
      yearTo: item.yearTo,
    })).sort((a, b) => (a.capacity ?? "").localeCompare(b.capacity ?? "") || (a.powerPs ?? 0) - (b.powerPs ?? 0) || (a.yearFrom ?? 0) - (b.yearFrom ?? 0));
    return {
      available: modifications.length > 0,
      modifications,
      ...(modifications.length === 0 ? { message: "Для этого поколения в каталоге нет двигателей. Напишите нам VIN — подберём вручную." } : {}),
    };
  }

  /** The cars a VIN may be: the customer confirms one. */
  async vin(vin: string, caller: TecdocCaller) {
    const candidates = await this.gateway.get(`/vin/${encodeURIComponent(vin)}`, {}, caller, normalizeVin, { isEmpty: (list) => list.length === 0 });
    return {
      vehicles: candidates.slice(0, 20).map((item) => {
        const parsed = parseModelName(item.model, SEED_BY_KEY.get(brandKey(item.make))?.models ?? []);
        const seedMake = SEED_BY_KEY.get(brandKey(item.make));
        return {
          engine: [item.capacityLiters ? `${item.capacityLiters} л` : null, item.engineCodes.slice(0, 2).join(", ") || null, item.powerPs ? `${item.powerPs} л.с.` : null].filter(Boolean).join(" · ") || item.generation,
          generation: [parsed.generation, item.yearFrom ? `${item.yearFrom}–${item.yearTo ?? "н.в."}` : null, parsed.body ?? item.body?.toLowerCase()].filter(Boolean).join(" · "),
          make: seedMake?.name ?? pretty(item.make),
          model: pretty(parsed.family),
          tecdoc: { genId: item.genId, ...(item.makeId ? { mfaId: item.makeId } : {}), ...(item.msId ? { msId: item.msId } : {}) },
        };
      }),
    };
  }

  /* ---------------- Parts for a car ---------------- */

  private categoryTree(genId: number, caller: TecdocCaller): Promise<TecdocCategory[]> {
    return this.gateway.get("/category", { as_tree: true, cat_type: VEHICLE_TYPE, gen_id: genId }, caller, normalizeCategories, { isEmpty: (tree) => tree.length === 0 });
  }

  /** The car's parts tree; with `query`, also the categories its words name (no extra call). */
  async categories(genId: number, query: string | undefined, caller: TecdocCaller): Promise<{ matches: CategoryMatch[]; tree: TecdocCategory[] }> {
    const tree = await this.categoryTree(genId, caller);
    return { matches: query ? matchCategories(tree, query) : [], tree };
  }

  /**
   * What fits the car in one category, OUR products first.
   *  1. one call names every brand (and article) the catalogue lists there;
   *  2. only for brands we actually sell — at most MAX_BRAND_CALLS — one call
   *     each returns the parts with their original numbers;
   *  3. every part is looked up in our catalog (number, original number, our
   *     own confirmed crosses) — a database query of ours, no provider call;
   *  4. the general list («по каталогу, под заказ») is one more call, made
   *     only when asked for or when we have nothing.
   */
  async parts(input: { all: boolean; categoryId: number; genId: number; page: number }, caller: TecdocCaller) {
    const { categoryId, genId } = input;
    const rows = await this.gateway.get("/supplier", { gen_id: genId, mfa_type: VEHICLE_TYPE, str_id: categoryId }, caller, normalizeSupplierRows, { isEmpty: (list) => list.length === 0 });
    const [identities, carried] = await Promise.all([this.brandIdentities(), this.carriedBrands()]);
    const suppliers = new Map<string, { brand: string; products: number; supId: number }>();
    for (const row of rows) {
      const key = canonicalBrand(row.brand, identities);
      const products = carried.get(key);
      if (row.supId && products && !suppliers.has(key)) suppliers.set(key, { brand: row.brand, products, supId: row.supId });
    }
    // Rows that carry an article tell at once which of our brands really have a match.
    const withArticles = rows.filter((row) => row.article);
    let chosen = [...suppliers.entries()];
    if (withArticles.length > 0) {
      const direct = await this.shop.lookup(withArticles.map((row) => ({ article: row.article!, brand: row.brand })), 1);
      const matched = new Set(withArticles
        .filter((row) => offersOf(direct.for({ article: row.article!, brand: row.brand }), row.brand, identities).length > 0)
        .map((row) => canonicalBrand(row.brand, identities)));
      const complete = new Set(withArticles.map((row) => canonicalBrand(row.brand, identities)));
      chosen = chosen.filter(([key]) => matched.has(key) || !complete.has(key));
    }
    chosen = chosen.sort((a, b) => b[1].products - a[1].products).slice(0, MAX_BRAND_CALLS);

    const lists = await Promise.all(chosen.map(([, supplier]) => this.gateway.get(
      "/part", { gen_id: genId, oem: true, oem_search_limit: 10, per_page: PARTS_PER_PAGE, str_id: categoryId, sup_id: supplier.supId, with_full_url: true },
      caller, normalizeParts, { isEmpty: (list) => list.length === 0 },
    ).catch((error: unknown) => {
      // One brand failing must not hide the others; our limits and a missing key still stop everything.
      if (error instanceof TecdocError && error.failure === "unavailable") return [] as TecdocPart[];
      throw error;
    })));
    const ours = inStockFirst((await this.withShopOffers(lists.flat())).filter((part) => part.shop.length > 0));

    let catalog: TecdocPartView[] | null = null;
    let catalogHasMore = false;
    if (input.all || ours.length === 0) {
      const page = await this.gateway.get(
        "/part", { gen_id: genId, oem: true, oem_search_limit: 5, page: input.page, per_page: PARTS_PER_PAGE, simple: true, str_id: categoryId, with_full_url: true },
        caller, (payload) => ({ hasMore: hasMorePages(payload), parts: normalizeParts(payload) }), { isEmpty: (value) => value.parts.length === 0 },
      );
      // What is already shown as ours is not repeated in the general list.
      const shown = new Set(ours.map((part) => `${brandKey(part.brand)}\u0000${normalizeArticleNumber(part.article)}`));
      catalog = inStockFirst(await this.withShopOffers(page.parts.filter((part) => !shown.has(`${brandKey(part.brand)}\u0000${normalizeArticleNumber(part.article)}`))));
      catalogHasMore = page.hasMore;
    }
    return { catalog, catalogHasMore, checkedBrands: chosen.map(([, supplier]) => supplier.brand), listedBrands: new Set(rows.map((row) => row.brand)).size, ours };
  }

  /** «Деталь + машина» typed as text: the provider's own full-text search, matched to our stock. */
  async liveSearch(query: string, caller: TecdocCaller): Promise<TecdocPartView[]> {
    const parts = await this.gateway.get("/live-search", { per_page: PARTS_PER_PAGE, q: query, short: true, with_full_url: true }, caller, normalizeParts, { isEmpty: (list) => list.length === 0 });
    return inStockFirst(await this.withShopOffers(parts));
  }

  /* ---------------- A number: what we sell for it ---------------- */

  /**
   * Our products for a part number through the catalogue's own crosses: the
   * number itself and every analog the search names are looked up in our
   * catalog at this moment. Nothing is stored: the pair is known only for
   * this answer.
   */
  async offersForNumber(article: string, caller: TecdocCaller): Promise<{ analogs: Array<{ article: string; brand: string; name: string }>; shop: ShopOffer[] }> {
    const parts = await this.gateway.get("/search", { search_number: article }, caller, normalizeParts, { isEmpty: (list) => list.length === 0 });
    const wanted = normalizeArticleNumber(article);
    const [lookup, identities] = await Promise.all([
      this.shop.lookup(parts.map((part) => ({ article: part.article, brand: part.brand })), SHOP_OFFERS_PER_PART), this.brandIdentities(),
    ]);
    const seen = new Set<string>();
    const shop: ShopOffer[] = [];
    for (const part of parts) {
      const same = normalizeArticleNumber(part.article) === wanted;
      // The number the visitor typed may be any brand's; an analog must be the named brand's part.
      const offers = lookup.for({ article: part.article, brand: part.brand }).filter((offer) => offer.matchedVia === "exact");
      for (const offer of same ? offers : offersOf(offers, part.brand, identities)) {
        if (seen.has(offer.productId)) continue;
        seen.add(offer.productId);
        shop.push(same ? offer : { ...offer, matchedVia: "cross" });
      }
    }
    shop.sort((a, b) => Number(b.availableQuantity > 0) - Number(a.availableQuantity > 0) || Number(a.matchedVia !== "exact") - Number(b.matchedVia !== "exact"));
    return {
      analogs: parts.filter((part) => normalizeArticleNumber(part.article) !== wanted).slice(0, 30).map((part) => ({ article: part.article, brand: part.brand, name: part.name })),
      shop: shop.slice(0, 12),
    };
  }

  /* ---------------- A product of ours: which cars it fits ---------------- */

  /**
   * Two buttons of the product page, nothing on its opening (docs/TECDOC.md, «Применимость»): `check` — does it fit
   * the customer's car — is /search and /applicability for the car's model (2 requests); `list` — which cars it fits
   * — is /search and the part's card with its cars and original numbers (2 requests). The gateway keeps /search for
   * the day, so both buttons in a row cost 3.
   */
  async productFitment(productId: string, car: { genId?: number; msId?: number }, caller: TecdocCaller, mode: "check" | "list" = "list"): Promise<
    | { status: "not_applicable" | "not_found" | "unknown_part" }
    | { article: { brand: string; name: string; number: string }; makes: TecdocFitmentMake[]; oems: TecdocOem[]; status: "ok"; total: number; verdict: FitmentVerdict | null }
  > {
    const found = await this.database.query<{ brand: string | null; section: string | null; sku: string }>(
      // Only a product a customer can open: one in a hidden section is answered as «not found», like its page.
      `${VISIBLE_CATEGORIES_CTE}
       SELECT product.sku::text AS sku,brand.name AS brand,COALESCE(parent.slug,category.slug)::text AS section
       FROM app.products AS product
       LEFT JOIN app.brands AS brand ON brand.id=product.brand_id AND brand.is_active AND brand.deleted_at IS NULL
       LEFT JOIN app.categories AS category ON category.id=product.category_id
       LEFT JOIN app.categories AS parent ON parent.id=category.parent_id
       WHERE product.id=$1 AND product.is_active AND product.deleted_at IS NULL
         AND (product.category_id IS NULL OR category.id IN (SELECT id FROM visible_categories))`,
      [productId],
    );
    const product = found.rows[0];
    if (!product) return { status: "not_found" };
    // Oils, fluids, chemistry and tools have no part-number catalogue: no call is spent on them.
    if (!partNumberCatalogueApplies(product)) return { status: "not_applicable" };
    const identities = await this.brandIdentities();
    const ours = canonicalBrand(product.brand, identities);
    const wanted = normalizeArticleNumber(product.sku);
    const candidates = await this.gateway.get("/search", { search_number: product.sku }, caller, normalizeParts, { isEmpty: (list) => list.length === 0 });
    // The catalogue's part is ours only when both the number and the brand are: a number alone is not an identity.
    const match = candidates.find((part) => part.artId !== null && normalizeArticleNumber(part.article) === wanted && canonicalBrand(part.brand, identities) === ours);
    if (!match?.artId) return { status: "unknown_part" };
    if (mode === "check" && car.msId) {
      const ids = await this.gateway.get("/applicability", { art_id: match.artId, id_only: true, lat_type: VEHICLE_TYPE, ms_id: car.msId }, caller, collectGenerationIds);
      // No engine of this model is listed: the catalogue does not name the part for the car.
      const verdict: FitmentVerdict = ids.length === 0 ? "not_listed" : !car.genId ? "model" : ids.includes(car.genId) ? "fits" : "other_engine";
      return { article: { brand: match.brand, name: match.name, number: match.article }, makes: [], oems: [], status: "ok", total: 0, verdict };
    }
    const detail = await this.gateway.get(`/part/${match.artId}`, { applicability: true, lat_type: VEHICLE_TYPE, oem: true }, caller, normalizePartDetail);
    const models = detail.fitment.flatMap((make) => make.models);
    // The list itself says only that the customer's model is not in it; whether it fits is the other button.
    const verdict: FitmentVerdict | null = car.msId && !models.some((model) => model.msId === car.msId) ? "not_listed" : null;
    return {
      article: { brand: match.brand, name: detail.part?.name || match.name, number: match.article },
      makes: detail.fitment.map((make) => ({ ...make, make: SEED_BY_KEY.get(brandKey(make.make))?.name ?? pretty(make.make) })),
      oems: detail.oems.slice(0, 12),
      status: "ok",
      total: models.length,
      verdict,
    };
  }

  /* ---------------- Staff ---------------- */

  /** A short chain of real calls (make → model → engine → categories) that shows the key and the answers work. */
  async probe(caller: TecdocCaller) {
    const makes = await this.makeList(caller);
    const toyota = makes.find((make) => brandKey(make.name) === "TOYOTA") ?? makes[0];
    if (!toyota) return { categories: 0, engines: 0, makes: 0, models: 0, sample: null };
    const models = await this.models(toyota.id, caller);
    const model = models.models.find((item) => /corolla/iu.test(item.family)) ?? models.models[0];
    const engines = model ? await this.modifications(model.id, caller) : null;
    const engine = engines?.modifications[0];
    const tree = engine ? await this.categoryTree(engine.id, caller) : [];
    return {
      categories: tree.length,
      engines: engines?.modifications.length ?? 0,
      makes: makes.length,
      models: models.models.length,
      sample: model ? `${models.make.name} ${model.family}${model.generation ? ` (${model.generation})` : ""}${engine ? `, ${engine.label}` : ""}` : null,
    };
  }

  /* ---------------- Our own data ---------------- */

  private async withShopOffers(parts: readonly TecdocPart[]): Promise<TecdocPartView[]> {
    if (parts.length === 0) return [];
    const numbers: ShopOfferRequest[] = parts.map((part) => ({ article: part.article, brand: part.brand }));
    const originals: ShopOfferRequest[] = parts.flatMap((part) => part.oems.map((oem) => ({ article: oem.number, brand: oem.brand })));
    const [byNumber, byOriginal, identities] = await Promise.all([
      this.shop.lookup(numbers, SHOP_OFFERS_PER_PART), this.shop.lookup(originals, 2), this.brandIdentities(),
    ]);
    return parts.map((part) => {
      const seen = new Set<string>();
      const shop: ShopOffer[] = [];
      const add = (offer: ShopOffer) => { if (!seen.has(offer.productId)) { seen.add(offer.productId); shop.push(offer); } };
      offersOf(byNumber.for({ article: part.article, brand: part.brand }), part.brand, identities).forEach(add);
      // Our product IS the original number of this part: it fits the car as well.
      for (const oem of part.oems) {
        offersOf(byOriginal.for({ article: oem.number, brand: oem.brand }), oem.brand, identities).filter((offer) => offer.matchedVia === "exact").forEach(add);
      }
      return {
        article: part.article, brand: part.brand, criteria: part.criteria.slice(0, 5), group: part.group, image: part.image, name: part.name,
        oems: part.oems.slice(0, 6), shop: shop.slice(0, SHOP_OFFERS_PER_PART + 1),
      };
    });
  }

  private async brandIdentities(): Promise<BrandIdentities> {
    if (!this.identities || Date.now() - this.identities.at > OWN_DATA_TTL_MS) {
      const result = await this.database.query<{ alias: string; canonical: string }>("SELECT alias,canonical FROM app.brand_identities");
      this.identities = { at: Date.now(), value: new Map(result.rows.map((row) => [row.alias, row.canonical])) };
    }
    return this.identities.value;
  }

  /** Brands we sell (by identity) with the number of active products. */
  private async carriedBrands(): Promise<Map<string, number>> {
    if (!this.carried || Date.now() - this.carried.at > OWN_DATA_TTL_MS) {
      const result = await this.database.query<{ key: string; products: number }>(
        `SELECT app.canonical_brand(brand.name) AS key,count(*)::int AS products
         FROM app.products AS product JOIN app.brands AS brand ON brand.id=product.brand_id
         WHERE product.is_active AND product.deleted_at IS NULL AND brand.is_active AND brand.deleted_at IS NULL
         GROUP BY 1`,
      );
      this.carried = { at: Date.now(), value: new Map(result.rows.map((row) => [row.key, row.products])) };
    }
    return this.carried.value;
  }
}
