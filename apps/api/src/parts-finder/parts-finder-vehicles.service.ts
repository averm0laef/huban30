import { Injectable, Logger } from "@nestjs/common";

import { DatabaseService } from "../infrastructure/database.service.js";
import { PartsFinderError } from "./engine/errors.js";
import {
  ALIASES, EMPTY_VOCABULARY, buildVehicleVocabulary, normalizeQuery, oneTypo, phoneticKey, phoneticLatin, toLatinLayout, toRussianLayout, words,
  type VehicleVocabulary,
} from "./engine/part-query.js";
import { CATEGORIES } from "./engine/vehicle-parts.js";
import { parseModelName } from "./engine/model-name.js";
import { VEHICLE_SEED, slugify } from "./engine/vehicle-seed.js";
import { PartsFinderEngine } from "./parts-finder.engine.js";

const REFRESH_SECONDS = 90 * 86_400;
const SYNC_PAUSE_MS = 400;

/** FAPI writes "1.6 l"; the storefront adds its own «л». */
export function cleanCapacity(value: string | null): string | null {
  const text = value?.replace(/\s*(?:l|л)\.?$/iu, "").replace(",", ".").trim();
  return text ? text : null;
}

/** Seed names ("Priora", "2110") that a FAPI generation already covers ("Priora Седан (2170_)", "110 (2110)"). */
export function coveredBySeed(seedName: string, fapiNames: readonly string[]): boolean {
  const seed = seedName.toLowerCase();
  return fapiNames.some((raw) => {
    const name = raw.toLowerCase();
    const inner = /\(([^)]*)\)/u.exec(name)?.[1]?.split(/[,\s]+/u) ?? [];
    const base = name.split("(", 1)[0]!;
    // "RAV4" is written "RAV 4 I", "Noah" is half of "Noah/Voxy".
    const halves = base.split("/").map((half) => half.trim());
    return name === seed || name.startsWith(`${seed} `) || inner.includes(seed)
      || base.replace(/\s+/gu, "").startsWith(seed.replace(/\s+/gu, "")) || halves.includes(seed);
  });
}

const SNAPSHOT_SECONDS = 300;

export interface PickerMake {
  country: string | null;
  id: number;
  name: string;
  nameRu: string | null;
  slug: string;
}

export interface PickerModel {
  body?: string | null;
  family?: string;
  fapi: boolean;
  generation?: string | null;
  id: number;
  name: string;
  yearFrom: number | null;
  yearTo: number | null;
}

export interface PickerModification {
  body: string | null;
  capacity: string | null;
  engine: string | null;
  id: number;
  label: string;
  yearFrom: number | null;
  yearTo: number | null;
}

export interface SelectedVehicle {
  capacity: string | null;
  engine: string | null;
  fapiMakeId: number | null;
  fapiModelId: number | null;
  fapiModificationId: number | null;
  label: string;
  make: string;
  model: string;
}

interface MakeRow { country: string | null; fapi_id: number | null; id: number; models_checked_at: Date | null; name: string; name_ru: string | null; popular_rank: number | null; slug: string }
interface ModelRow { fapi_id: number | null; fapi_title: string | null; id: number; make_id: number; modifications_checked_at: Date | null; name: string; name_ru: string | null; slug: string; year_from: number | null; year_to: number | null }
interface ModificationRow { body: string | null; capacity: string | null; engine: string | null; fapi_id: number; id: number; label: string; model_id: number; year_from: number | null; year_to: number | null }

const EUROPE = new Set(["Германия", "Франция", "Чехия", "Великобритания", "Швеция", "Италия", "Испания", "Румыния"]);

/** Sync priority of a make's home region: Japan, Europe, Korea, then everything else. */
export function regionOrder(country: string | null): number {
  if (country === "Япония") return 0;
  if (country !== null && EUROPE.has(country)) return 1;
  return country === "Корея" ? 2 : 3;
}

/** Seed model names that exist among the loaded families, in the seed's own order. */
export function popularFamilies(seed: readonly string[], models: ReadonlyArray<{ family?: string; name: string }>): string[] {
  // "RAV4" is "RAV 4" in the catalogue and "Noah" lives in "Noah/Voxy": compare without spaces, by each half.
  const key = (value: string) => value.toLowerCase().replace(/[\s-]+/gu, "");
  const present = new Map<string, string>();
  for (const model of models) {
    const family = model.family ?? model.name;
    for (const part of [family, ...family.split("/")]) if (!present.has(key(part))) present.set(key(part), family);
  }
  return [...new Set(seed.flatMap((name) => { const found = present.get(key(name)); return found ? [found] : []; }))];
}

const SOUND_CACHE = new Map<string, string>();

/** phoneticKey of a catalog word, remembered: the typeahead compares every model on each keystroke. */
function soundOf(word: string): string {
  let sound = SOUND_CACHE.get(word);
  if (sound === undefined) {
    sound = phoneticKey(word);
    if (SOUND_CACHE.size < 50_000) SOUND_CACHE.set(word, sound);
  }
  return sound;
}

/** A make's list of models: asked again once a quarter (8 credits a make). */
function stale(checkedAt: Date | null): boolean {
  return !checkedAt || Date.now() - checkedAt.getTime() > REFRESH_SECONDS * 1000;
}

/**
 * A generation's engines: once loaded, a generation that ended production
 * never changes and is never paid for again; a current one is asked again
 * once a quarter.
 */
export function modificationsStale(model: { modifications_checked_at: Date | null; year_to: number | null }, now = new Date()): boolean {
  if (!model.modifications_checked_at) return true;
  if (model.year_to !== null && model.year_to < now.getUTCFullYear() - 1) return false;
  return now.getTime() - model.modifications_checked_at.getTime() > REFRESH_SECONDS * 1000;
}

function yearOf(milliseconds: unknown): number | null {
  return typeof milliseconds === "number" && Number.isInteger(milliseconds) && milliseconds ? new Date(milliseconds).getUTCFullYear() : null;
}

function rows(raw: unknown, key?: string): Array<Record<string, unknown>> {
  const list = key && raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>)[key] : raw;
  return Array.isArray(list) ? list.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null) : [];
}

function keyOf(value: string): string {
  return words(value).map((token) => ALIASES[token] ?? token).join(" ");
}

/** "CAMRY (XV70)" -> "Camry (XV70)": readable FAPI model titles. */
export interface VehicleCatalogSyncReport {
  creditsUsed: number;
  error: string | null;
  finishedAt: string;
  makesLinked: number;
  modelsRefreshed: number;
  modificationsRefreshed: number;
}

function prettyModel(title: string, makeName: string): string {
  let text = title.trim();
  if (text.toUpperCase().startsWith(`${makeName.toUpperCase()} `)) text = text.slice(makeName.length + 1);
  return text.replace(/[A-Za-zА-Яа-яЁё]+/gu, (word) => (word.length <= 3 || /\d/u.test(word) ? word.toUpperCase() : word[0]!.toUpperCase() + word.slice(1).toLowerCase()));
}

/**
 * Make -> model -> modification picker. A hand-made seed answers instantly
 * with FAPI off; FAPI manufacturer, model and modification lists (credits
 * through the shared ledger, cached by it for 7 days) fill years, generations
 * and engines on demand and are kept here for 30 days.
 */
@Injectable()
export class PartsFinderVehiclesService {
  private readonly logger = new Logger(PartsFinderVehiclesService.name);
  private seeded: Promise<void> | null = null;
  private snapshot: { at: number; makes: MakeRow[]; models: ModelRow[] } | null = null;
  private readonly refreshing = new Map<string, Promise<void>>();

  constructor(
    private readonly database: DatabaseService,
    private readonly engine: PartsFinderEngine,
  ) {}

  private get fapiUsable(): boolean {
    return Boolean(this.engine.fapiKey);
  }

  ensureSeeded(): Promise<void> {
    this.seeded ??= this.seed().catch((error: unknown) => {
      this.seeded = null;
      throw error;
    });
    return this.seeded;
  }

  private async seed(): Promise<void> {
    await this.database.transaction(async (client) => {
      for (const make of VEHICLE_SEED) {
        const inserted = await client.query<{ id: number }>(
          `INSERT INTO app.parts_finder_vehicle_makes (slug,name,name_ru,country,popular_rank) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name,name_ru=EXCLUDED.name_ru,country=EXCLUDED.country,popular_rank=EXCLUDED.popular_rank
           RETURNING id`,
          [make.slug, make.name, make.nameRu, make.country, make.rank],
        );
        const makeId = inserted.rows[0]!.id;
        await client.query(
          `INSERT INTO app.parts_finder_vehicle_models (make_id,slug,name)
           SELECT $1,model.slug,model.name FROM jsonb_to_recordset($2::jsonb) AS model(slug text,name text)
           WHERE NOT EXISTS (SELECT 1 FROM app.parts_finder_vehicle_models AS gen WHERE gen.make_id=$1
             AND gen.fapi_id IS NOT NULL AND lower(split_part(gen.name,' (',1))=lower(model.name))
           ON CONFLICT (make_id,slug) DO NOTHING`,
          [makeId, JSON.stringify(make.models.map((name) => ({ name, slug: slugify(name) })))],
        );
      }
    });
  }

  private async load(): Promise<{ makes: MakeRow[]; models: ModelRow[] }> {
    await this.ensureSeeded();
    if (this.snapshot && Date.now() / 1000 - this.snapshot.at < SNAPSHOT_SECONDS) return this.snapshot;
    const [makes, models] = await Promise.all([
      this.database.query<MakeRow>("SELECT id,slug,name,name_ru,country,popular_rank,fapi_id,models_checked_at FROM app.parts_finder_vehicle_makes"),
      this.database.query<ModelRow>(
        "SELECT id,make_id,slug,name,name_ru,year_from,year_to,fapi_id,fapi_title,modifications_checked_at FROM app.parts_finder_vehicle_models",
      ),
    ]);
    this.snapshot = { at: Date.now() / 1000, makes: makes.rows, models: models.rows };
    return this.snapshot;
  }

  private invalidate() {
    this.snapshot = null;
    this.vocabularyCache = null;
  }

  private vocabularyCache: { at: number; value: VehicleVocabulary } | null = null;

  /**
   * Car names for the query reader («гайя» -> Toyota Gaia), from the makes
   * and models of this catalog. Names of the brands we sell stay brands
   * («сакура» is a filter maker here, not the Nissan). Never fails a search:
   * on any error the built-in list is used.
   */
  async vocabulary(): Promise<VehicleVocabulary> {
    if (this.vocabularyCache && Date.now() / 1000 - this.vocabularyCache.at < SNAPSHOT_SECONDS) return this.vocabularyCache.value;
    try {
      const { makes, models } = await this.load();
      const brands = await this.database.query<{ name: string }>("SELECT name FROM app.brands WHERE is_active AND deleted_at IS NULL");
      const byId = new Map(makes.map((make) => [make.id, make]));
      const value = buildVehicleVocabulary({
        exclude: brands.rows.map((row) => row.name),
        makes: makes.map((make) => ({ name: make.name, nameRu: make.name_ru })),
        models: models.flatMap((model) => {
          const make = byId.get(model.make_id);
          return make ? [{ make: make.name, name: model.fapi_title ? prettyModel(model.fapi_title, make.name) : model.name }] : [];
        }),
      });
      this.vocabularyCache = { at: Date.now() / 1000, value };
      return value;
    } catch (error) {
      this.logger.warn(`vehicle vocabulary unavailable: ${error instanceof Error ? error.name : "unknown"}`);
      return EMPTY_VOCABULARY;
    }
  }

  async makes(): Promise<{ groups: Array<{ letter: string; makes: PickerMake[] }>; popular: PickerMake[] }> {
    const loaded = await this.load();
    // A make without a single model yet is a dead end: it appears once the FAPI sync fills it.
    const withModels = new Set(loaded.models.map((model) => model.make_id));
    const makes = loaded.makes.filter((make) => withModels.has(make.id));
    const view = (row: MakeRow): PickerMake => ({ country: row.country, id: row.id, name: row.name, nameRu: row.name_ru, slug: row.slug });
    const popular = makes.filter((row) => row.popular_rank !== null).sort((a, b) => a.popular_rank! - b.popular_rank!).map(view);
    const sorted = [...makes].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
    const groups = new Map<string, PickerMake[]>();
    for (const row of sorted) {
      const first = row.name[0]!.toUpperCase();
      const letter = /[A-Z]/u.test(first) ? first : /\d/u.test(first) ? "0–9" : first;
      groups.set(letter, [...(groups.get(letter) ?? []), view(row)]);
    }
    return { groups: [...groups.entries()].map(([letter, list]) => ({ letter, makes: list })), popular };
  }

  async models(makeSlug: string): Promise<{ make: PickerMake; models: PickerModel[]; popular: string[]; source: "fapi" | "seed" }> {
    let { makes } = await this.load();
    let make = makes.find((row) => row.slug === makeSlug);
    if (!make) throw new PartsFinderError(404, "vehicle_make_not_found", "Марка не найдена. Выберите её из списка.");
    if (this.fapiUsable && stale(make.models_checked_at)) {
      const refresh = this.refreshModels(make);
      if (make.models_checked_at) void refresh.catch(() => undefined);
      else await refresh.catch(() => undefined);
      ({ makes } = await this.load());
      make = makes.find((row) => row.slug === makeSlug)!;
    }
    const { models } = await this.load();
    const own = models.filter((row) => row.make_id === make.id);
    const withFapi = own.some((row) => row.fapi_id !== null);
    const fapiNames = own.filter((row) => row.fapi_id !== null).map((row) => row.name);
    // "Mark II", "Land Cruiser Prado": names the seed knows stay whole when a generation is split into parts.
    const knownFamilies = VEHICLE_SEED.find((seed) => seed.slug === make.slug)?.models ?? [];
    const list = own
      // When FAPI generations exist, a seed row that FAPI could not match stays as a fallback.
      .filter((row) => row.fapi_id !== null || !withFapi || !coveredBySeed(row.name, fapiNames))
      .map((row): PickerModel => ({
        ...parseModelName(row.name, knownFamilies), fapi: row.fapi_id !== null, id: row.id, name: row.name, yearFrom: row.year_from, yearTo: row.year_to,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true, sensitivity: "base" }) || (b.yearFrom ?? 0) - (a.yearFrom ?? 0));
    return {
      make: { country: make.country, id: make.id, name: make.name, nameRu: make.name_ru, slug: make.slug },
      models: list,
      // The hand-made list of the make names what people here actually drive.
      popular: popularFamilies(knownFamilies, list),
      source: withFapi ? "fapi" : "seed",
    };
  }

  async modifications(modelId: number): Promise<{ available: boolean; message?: string; model: PickerModel; modifications: PickerModification[] }> {
    const { models } = await this.load();
    const model = models.find((row) => row.id === modelId);
    if (!model) throw new PartsFinderError(404, "vehicle_model_not_found", "Модель не найдена. Выберите её из списка.");
    const view: PickerModel = { fapi: model.fapi_id !== null, id: model.id, name: model.name, yearFrom: model.year_from, yearTo: model.year_to };
    if (model.fapi_id !== null && this.fapiUsable && modificationsStale(model)) {
      const refresh = this.refreshModifications(model);
      if (model.modifications_checked_at) void refresh.catch(() => undefined);
      else {
        try {
          await refresh;
        } catch (error) {
          this.logger.warn(`modifications for model ${model.id}: ${error instanceof PartsFinderError ? error.code : "failed"}`);
        }
      }
    }
    const result = await this.database.query<ModificationRow>(
      `SELECT id,model_id,fapi_id,label,engine,capacity,year_from,year_to,body FROM app.parts_finder_vehicle_modifications
       WHERE model_id=$1 ORDER BY year_from DESC NULLS LAST,label`,
      [model.id],
    );
    const modifications = result.rows.map((row): PickerModification => ({
      body: row.body, capacity: cleanCapacity(row.capacity), engine: row.engine, id: row.id, label: row.label, yearFrom: row.year_from, yearTo: row.year_to,
    }));
    if (modifications.length > 0) return { available: true, model: view, modifications };
    return {
      available: false,
      message: "Модификации для этой модели пока не загружены. Напишите деталь — уточним двигатель на следующем шаге.",
      model: view,
      modifications,
    };
  }

  /** Typeahead over make + model names: aliases, wrong keyboard layout and single typos. */
  async suggest(query: string): Promise<Array<{ label: string; make: PickerMake; model: PickerModel | null }>> {
    const { makes, models } = await this.load();
    const tokens = new Set<string>();
    for (const token of normalizeQuery(query, CATEGORIES).tokens) tokens.add(token);
    for (const raw of words(query)) {
      for (const variant of [raw, ...words(toLatinLayout(raw)), ...words(toRussianLayout(raw)), ...phoneticLatin(raw)]) tokens.add(ALIASES[variant] ?? variant);
    }
    const list = [...tokens].filter((token) => token.length >= 2);
    if (list.length === 0) return [];
    // «гайя», «вокс»: a name typed by ear in Russian is compared by how it sounds.
    const sounds = words(query).filter((word) => /^[а-я]{3,}$/u.test(word)).map((word) => phoneticKey(word)).filter((key) => key.length >= 3);
    const soundsLike = (part: string) => sounds.length > 0 && /^[a-z]{3,}$/u.test(part) && sounds.some((sound) => soundOf(part).startsWith(sound));
    const matches = (key: string) => {
      const parts = key.split(" ");
      return parts.some((part) => soundsLike(part)) || list.some((token) => parts.some((part) => part.startsWith(token) || (token.length >= 4 && oneTypo(token, part))));
    };
    const exact = (key: string) => key.split(" ").some((part) => soundsLike(part) || list.some((token) => part.startsWith(token)));
    const makeView = (row: MakeRow): PickerMake => ({ country: row.country, id: row.id, name: row.name, nameRu: row.name_ru, slug: row.slug });
    const matchedMakes = makes.filter((row) => matches(keyOf(row.name)) || matches(keyOf(row.slug.replaceAll("-", " ")))
      || (row.name_ru !== null && matches(keyOf(row.name_ru))) || (ALIASES[row.slug] !== undefined && matches(ALIASES[row.slug]!)));
    const matchedMakeIds = new Set(matchedMakes.map((row) => row.id));
    // «тойота га»: a make named in full narrows the models to that make.
    const namedMakeIds = new Set(makes.filter((row) => [keyOf(row.name), row.name_ru ? keyOf(row.name_ru) : ""]
      .some((key) => key !== "" && key.split(" ").every((part) => tokens.has(part)))).map((row) => row.id));
    const makeScore = (id: number) => (namedMakeIds.size > 0 ? (namedMakeIds.has(id) ? 0 : 20) : matchedMakeIds.has(id) ? 0 : 10);
    const results: Array<{ label: string; make: PickerMake; model: PickerModel | null; score: number }> = [];
    for (const model of models) {
      const make = makes.find((row) => row.id === model.make_id);
      if (!make || !matches(keyOf(model.name))) continue;
      const score = makeScore(make.id) + (exact(keyOf(model.name)) ? 0 : 2) + (make.popular_rank ?? 50) / 100 + (model.fapi_id === null ? 0 : 0.5);
      results.push({
        label: `${make.name} ${model.name}`,
        make: makeView(make),
        model: { fapi: model.fapi_id !== null, id: model.id, name: model.name, yearFrom: model.year_from, yearTo: model.year_to },
        score,
      });
    }
    for (const make of matchedMakes) results.push({ label: make.name, make: makeView(make), model: null, score: 5 + (make.popular_rank ?? 50) / 100 });
    // A make alone is the better answer when no model of it matched.
    return results
      .filter((item) => item.model !== null || !results.some((other) => other.model && other.make.id === item.make.id))
      .sort((a, b) => a.score - b.score || a.label.localeCompare(b.label))
      .slice(0, 10)
      .map(({ label, make, model }) => ({ label, make, model }));
  }

  /** What the guided search needs for a picked modification (or a model without one). */
  async selected(input: { modelId?: number; modificationId?: number }): Promise<SelectedVehicle> {
    const { makes, models } = await this.load();
    let modification: ModificationRow | undefined;
    let modelId = input.modelId;
    if (input.modificationId) {
      modification = (await this.database.query<ModificationRow>(
        "SELECT id,model_id,fapi_id,label,engine,capacity,year_from,year_to,body FROM app.parts_finder_vehicle_modifications WHERE id=$1",
        [input.modificationId],
      )).rows[0];
      if (!modification) throw new PartsFinderError(400, "invalid_vehicle", "Выберите автомобиль из списка заново.");
      modelId = modification.model_id;
    }
    const model = models.find((row) => row.id === modelId);
    const make = model ? makes.find((row) => row.id === model.make_id) : undefined;
    if (!model || !make) throw new PartsFinderError(400, "invalid_vehicle", "Выберите автомобиль из списка заново.");
    const baseModel = (model.fapi_title ?? model.name).split("(")[0]!.trim();
    return {
      capacity: cleanCapacity(modification?.capacity ?? null),
      engine: modification?.engine ?? null,
      fapiMakeId: make.fapi_id,
      fapiModelId: model.fapi_id,
      fapiModificationId: modification?.fapi_id ?? null,
      label: [make.name, model.name, modification?.label].filter(Boolean).join(" · "),
      make: make.name,
      model: baseModel,
    };
  }

  private syncRun: Promise<VehicleCatalogSyncReport> | null = null;
  private lastSync: VehicleCatalogSyncReport | null = null;

  /** Last finished (or running) sync and the size of the vehicle catalog, for the staff card. */
  async catalogStatus(): Promise<{ makes: number; models: number; modifications: number; running: boolean; lastSync: VehicleCatalogSyncReport | null }> {
    const counts = await this.database.query<{ makes: string; models: string; modifications: string }>(
      `SELECT (SELECT count(*) FROM app.parts_finder_vehicle_makes)::text AS makes,
              (SELECT count(*) FROM app.parts_finder_vehicle_models)::text AS models,
              (SELECT count(*) FROM app.parts_finder_vehicle_modifications)::text AS modifications`,
    );
    const row = counts.rows[0]!;
    return { lastSync: this.lastSync, makes: Number(row.makes), models: Number(row.models), modifications: Number(row.modifications), running: this.syncRun !== null };
  }

  /**
   * Fills the vehicle catalog from FAPI (TecDoc data): every manufacturer,
   * then the models of each make, then — for the popular makes — every
   * modification with its engine code. Calls already cached cost nothing;
   * `maxCredits` caps one run. Runs once at a time, in the background.
   */
  startCatalogSync(options: { allMakes: boolean; maxCredits: number; modifications: boolean }): { started: boolean } {
    if (this.syncRun || !this.fapiUsable) return { started: false };
    this.syncRun = this.syncCatalog(options)
      .then((report) => { this.lastSync = report; return report; })
      .catch((error: unknown) => {
        const report: VehicleCatalogSyncReport = { creditsUsed: 0, error: error instanceof PartsFinderError ? error.message : "Синхронизация прервалась.", finishedAt: new Date().toISOString(), makesLinked: 0, modelsRefreshed: 0, modificationsRefreshed: 0 };
        this.lastSync = report;
        this.logger.warn(`vehicle catalog sync failed: ${error instanceof Error ? error.message : "unknown"}`);
        return report;
      })
      .finally(() => { this.syncRun = null; });
    return { started: true };
  }

  private async syncCatalog(options: { allMakes: boolean; maxCredits: number; modifications: boolean }): Promise<VehicleCatalogSyncReport> {
    const startUsed = (await this.engine.ledger.summary(this.engine.today())).reservedToday;
    const spent = async () => (await this.engine.ledger.summary(this.engine.today())).reservedToday - startUsed;
    const report: VehicleCatalogSyncReport = { creditsUsed: 0, error: null, finishedAt: "", makesLinked: 0, modelsRefreshed: 0, modificationsRefreshed: 0 };
    await this.ensureSeeded();
    const manufacturers = rows(await this.engine.fapi.fetch("/catalogList/dt/manufacturerList", {}, 3), "mf");
    // Only the curated makes (vehicle-seed.ts) are linked: FAPI also lists
    // motorcycles, scooters and joint ventures nobody looks for here.
    let { makes } = await this.load();
    for (const make of makes) {
      if (make.fapi_id !== null) continue;
      const target = new Set([keyOf(make.name), keyOf(make.slug.replaceAll("-", " "))]);
      const found = manufacturers.find((row) => typeof row.ds === "string" && target.has(keyOf(row.ds)) && typeof row.dbi === "number");
      if (!found) continue;
      await this.database.query("UPDATE app.parts_finder_vehicle_makes SET fapi_id=$2 WHERE id=$1 AND fapi_id IS NULL", [make.id, found.dbi]);
      report.makesLinked += 1;
    }
    this.invalidate();
    ({ makes } = await this.load());
    // The popular row first (Japanese, then European makes), then the rest by region.
    const ordered = [...makes].sort((a, b) => (a.popular_rank ?? 1_000) - (b.popular_rank ?? 1_000) || regionOrder(a.country) - regionOrder(b.country));
    for (const make of ordered) {
      if (await spent() >= options.maxCredits) break;
      if (make.popular_rank === null && !options.allMakes) continue;
      if (!stale(make.models_checked_at)) continue;
      if (!await this.syncStep(() => this.refreshModels(make), report)) break;
      report.modelsRefreshed += 1;
    }
    if (options.modifications) {
      const { models, makes: current } = await this.load();
      const rankOf = new Map(current.flatMap((make) => (make.popular_rank === null ? [] : [[make.id, make.popular_rank] as const])));
      const popular = new Set(rankOf.keys());
      // Japanese makes first, then European (vehicle-seed ranks); newer generations first within a make.
      const queue = [...models].sort((a, b) => (rankOf.get(a.make_id) ?? 1_000) - (rankOf.get(b.make_id) ?? 1_000) || (b.year_from ?? 0) - (a.year_from ?? 0));
      for (const model of queue) {
        if (await spent() >= options.maxCredits) break;
        if (model.fapi_id === null || !popular.has(model.make_id) || !modificationsStale(model)) continue;
        // Only generations still on the road: from 1995 on.
        if (model.year_to !== null && model.year_to < 1995) continue;
        if (!await this.syncStep(() => this.refreshModifications(model), report)) break;
        report.modificationsRefreshed += 1;
      }
    }
    report.creditsUsed = await spent();
    report.finishedAt = new Date().toISOString();
    return report;
  }

  /** One paid catalog call of a sync; false stops the run (limit, credits, refused key). */
  private async syncStep(step: () => Promise<void>, report: VehicleCatalogSyncReport): Promise<boolean> {
    try {
      await step();
      // FAPI rate-limits bursts: a short pause keeps a long run alive.
      await new Promise((resolve) => setTimeout(resolve, SYNC_PAUSE_MS));
      return true;
    } catch (error) {
      if (error instanceof PartsFinderError && [401, 402, 403, 429].includes(error.status)) {
        report.error = error.message;
        return false;
      }
      return true;
    }
  }

  private refreshModels(make: MakeRow): Promise<void> {
    const key = `make:${make.id}`;
    const pending = this.refreshing.get(key) ?? (async () => {
      let fapiMakeId = make.fapi_id;
      if (fapiMakeId === null) {
        const list = rows(await this.engine.fapi.fetch("/catalogList/dt/manufacturerList", {}, 3), "mf");
        const target = new Set([keyOf(make.name), keyOf(make.slug.replaceAll("-", " "))]);
        const found = list.find((row) => typeof row.ds === "string" && target.has(keyOf(row.ds)));
        if (!found || typeof found.dbi !== "number") {
          await this.database.query("UPDATE app.parts_finder_vehicle_makes SET models_checked_at=clock_timestamp() WHERE id=$1", [make.id]);
          return;
        }
        fapiMakeId = found.dbi;
        await this.database.query("UPDATE app.parts_finder_vehicle_makes SET fapi_id=$2 WHERE id=$1 AND fapi_id IS NULL", [make.id, fapiMakeId]);
      }
      const list = rows(await this.engine.fapi.fetch("/catalogList/dt/modelList", { mfi: fapiMakeId }, 8), "m");
      const items = list.flatMap((row) => {
        if (typeof row.dbi !== "number" || typeof row.d !== "string" || !row.d.trim()) return [];
        const name = prettyModel(row.d, make.name);
        return [{ fapi_id: row.dbi, fapi_title: row.d, name, slug: `${slugify(name)}-${row.dbi}`, year_from: yearOf(row.cb), year_to: yearOf(row.ce) }];
      });
      await this.database.transaction(async (client) => {
        await client.query(
          `INSERT INTO app.parts_finder_vehicle_models (make_id,slug,name,year_from,year_to,fapi_id,fapi_title)
           SELECT $1,item.slug,item.name,item.year_from,item.year_to,item.fapi_id,item.fapi_title
           FROM jsonb_to_recordset($2::jsonb) AS item(slug text,name text,year_from integer,year_to integer,fapi_id integer,fapi_title text)
           ON CONFLICT (fapi_id) DO UPDATE SET name=EXCLUDED.name,year_from=EXCLUDED.year_from,year_to=EXCLUDED.year_to,fapi_title=EXCLUDED.fapi_title`,
          [make.id, JSON.stringify(items)],
        );
        // Seed rows FAPI now covers by generation are hidden behind those generations.
        await client.query(
          `DELETE FROM app.parts_finder_vehicle_models AS seed WHERE seed.make_id=$1 AND seed.fapi_id IS NULL
             AND EXISTS (SELECT 1 FROM app.parts_finder_vehicle_models AS gen WHERE gen.make_id=$1 AND gen.fapi_id IS NOT NULL
               AND lower(split_part(gen.name,' (',1))=lower(seed.name))`,
          [make.id],
        );
        await client.query("UPDATE app.parts_finder_vehicle_makes SET models_checked_at=clock_timestamp() WHERE id=$1", [make.id]);
      });
      this.invalidate();
    })().finally(() => this.refreshing.delete(key));
    this.refreshing.set(key, pending);
    return pending;
  }

  private refreshModifications(model: ModelRow): Promise<void> {
    const key = `model:${model.id}`;
    const pending = this.refreshing.get(key) ?? (async () => {
      const list = rows(await this.engine.fapi.fetch("/catalogList/dt/modificationList", { mi: model.fapi_id! }, 8), "m");
      const items = list.flatMap((row) => {
        if (typeof row.dbi !== "number" || typeof row.d !== "string" || !row.d.trim()) return [];
        const start = yearOf(row.cb);
        const end = yearOf(row.ce);
        const engine = typeof row.engineCode === "string" && row.engineCode.trim() ? row.engineCode.trim() : null;
        const capacity = row.capacity === undefined || row.capacity === null || row.capacity === "" ? null : String(row.capacity);
        const bodyRaw = row.body ?? row.bodyType;
        let label = typeof row.fd === "string" && row.fd.trim() ? row.fd : row.d;
        if (start) label += end ? ` · ${start}–${end}` : ` · с ${start}`;
        if (engine && !label.includes(engine)) label += ` · ${engine}`;
        return [{ body: typeof bodyRaw === "string" && bodyRaw.trim() ? bodyRaw.trim() : null, capacity, engine, fapi_id: row.dbi, label, year_from: start, year_to: end }];
      });
      await this.database.transaction(async (client) => {
        await client.query(
          `INSERT INTO app.parts_finder_vehicle_modifications (model_id,fapi_id,label,engine,capacity,year_from,year_to,body)
           SELECT $1,item.fapi_id,item.label,item.engine,item.capacity,item.year_from,item.year_to,item.body
           FROM jsonb_to_recordset($2::jsonb) AS item(fapi_id integer,label text,engine text,capacity text,year_from integer,year_to integer,body text)
           ON CONFLICT (fapi_id) DO UPDATE SET label=EXCLUDED.label,engine=EXCLUDED.engine,capacity=EXCLUDED.capacity,
             year_from=EXCLUDED.year_from,year_to=EXCLUDED.year_to,body=EXCLUDED.body,fetched_at=clock_timestamp()`,
          [model.id, JSON.stringify(items)],
        );
        await client.query("UPDATE app.parts_finder_vehicle_models SET modifications_checked_at=clock_timestamp() WHERE id=$1", [model.id]);
      });
      this.invalidate();
    })().finally(() => this.refreshing.delete(key));
    this.refreshing.set(key, pending);
    return pending;
  }
}
