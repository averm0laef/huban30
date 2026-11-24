import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";

import { DatabaseService } from "../infrastructure/database.service.js";
import { PartsFinderError } from "./engine/errors.js";
import { ALIASES, normalizeQuery, oneTypo, phoneticKey, phoneticLatin, toLatinLayout, toRussianLayout, words } from "./engine/part-query.js";
import { CATEGORIES } from "./engine/vehicle-parts.js";
import { VEHICLE_SEED } from "./engine/vehicle-seed.js";
import {
  engineCodes, isCatalogId, makeViews, modelView, modificationView, sortModifications, yearOf,
  type CatalogPickerMake, type CatalogPickerModel, type CatalogPickerModification, type ModificationRowLike,
} from "./vehicle-catalog.logic.js";

const SNAPSHOT_SECONDS = 300;
const READY_SECONDS = 60;

interface MakeRow { id: number; name: string; umapi_id: number }
interface ModelRow { id: number; make_id: number; name: string; produced_from: Date | null; produced_to: Date | null; short_name: string | null }

type MakeView = CatalogPickerMake & { known: boolean; rank: number | null };

interface Family {
  family: string;
  key: string;
  make: MakeView;
  models: CatalogPickerModel[];
}

interface Snapshot {
  at: number;
  families: Family[];
  makeById: Map<number, MakeView>;
  makeBySlug: Map<string, MakeView>;
  makes: MakeView[];
  modelById: Map<number, CatalogPickerModel & { makeId: number }>;
  modelsByMake: Map<number, CatalogPickerModel[]>;
}

export interface CatalogSuggestion { family?: string; label: string; make: CatalogPickerMake; model: CatalogPickerModel | null }

/** A search request that names a car: the car, and what is left of the words — the part. */
export interface VehicleInQuery {
  family: string;
  label: string;
  make: CatalogPickerMake;
  /** The generations of that model; narrowed by a body code or a year typed along («b8», «2012»). */
  models: CatalogPickerModel[];
  part: string;
}

const PART_STOP_WORDS = new Set(["для", "на", "в", "к", "с", "по", "от", "купить", "нужен", "нужна", "нужны", "цена"]);

export interface CatalogSelectedVehicle {
  capacity: string | null; engine: string | null; fapiMakeId: null; fapiModelId: null; fapiModificationId: null; label: string; make: string; model: string;
}

export interface VehicleCatalogStatus {
  lastImport: { changes: unknown; fileName: string; finishedAt: string; rowsRejected: number; rowsTotal: number } | null;
  makes: number;
  models: number;
  modifications: number;
}

const SOUND_CACHE = new Map<string, string>();
function soundOf(word: string): string {
  let sound = SOUND_CACHE.get(word);
  if (sound === undefined) {
    sound = phoneticKey(word);
    if (SOUND_CACHE.size < 50_000) SOUND_CACHE.set(word, sound);
  }
  return sound;
}

function keyOf(value: string): string {
  return words(value).map((token) => ALIASES[token] ?? token).join(" ");
}

function publicMake(make: MakeView): CatalogPickerMake {
  return { country: make.country, id: make.id, name: make.name, nameRu: make.nameRu, slug: make.slug };
}

/**
 * Make -> model -> modification picker over the UMAPI passenger-car catalog
 * (docs/UMAPI.md). Everything is read from our own tables: choosing a car
 * costs no request to a paid catalogue. The catalog is in use once it holds
 * at least one shown modification; until then the former list answers.
 */
@Injectable()
export class VehicleCatalogService implements OnModuleInit {
  private readonly logger = new Logger(VehicleCatalogService.name);
  private snapshot: Snapshot | null = null;
  private loading: Promise<Snapshot> | null = null;
  private readyState: { at: number; value: boolean } | null = null;
  private readyCheck: Promise<boolean> | null = null;
  private warned = false;

  constructor(private readonly database: DatabaseService) {}

  // Asked before the server takes requests, so the first /status already knows. ready() never throws.
  async onModuleInit() {
    await this.ready();
  }

  /** The last known answer of ready(), without waiting (false until the first check ends). */
  get readyHint(): boolean {
    if (!this.readyState || Date.now() / 1000 - this.readyState.at > READY_SECONDS) void this.ready();
    return this.readyState?.value ?? false;
  }

  /** True when the catalog has been loaded (an import ran); a missing table or a database error is «not ready». */
  ready(): Promise<boolean> {
    if (this.readyState && Date.now() / 1000 - this.readyState.at < READY_SECONDS) return Promise.resolve(this.readyState.value);
    this.readyCheck ??= this.database.query<{ ready: boolean }>("SELECT EXISTS (SELECT 1 FROM app.vehicle_catalog_modifications WHERE is_active) AS ready")
      .then((result) => Boolean(result.rows[0]?.ready))
      .catch((error: unknown) => {
        if (!this.warned) this.logger.warn(`vehicle catalog unavailable: ${error instanceof Error ? error.message : "unknown"}`);
        this.warned = true;
        return false;
      })
      .then((value) => {
        if (value !== this.readyState?.value) this.snapshot = null;
        this.readyState = { at: Date.now() / 1000, value };
        return value;
      })
      .finally(() => { this.readyCheck = null; });
    return this.readyCheck;
  }

  owns(input: { modelId?: number; modificationId?: number }): boolean {
    return isCatalogId(input.modificationId ?? input.modelId);
  }

  private async load(): Promise<Snapshot> {
    if (this.snapshot && Date.now() / 1000 - this.snapshot.at < SNAPSHOT_SECONDS) return this.snapshot;
    this.loading ??= (async () => {
      const [makeRows, modelRows] = await Promise.all([
        this.database.query<MakeRow>("SELECT id, umapi_id, name FROM app.vehicle_catalog_makes WHERE is_active"),
        this.database.query<ModelRow>(
          `SELECT id, make_id, name, short_name, produced_from, produced_to FROM app.vehicle_catalog_models
           WHERE is_active AND EXISTS (SELECT 1 FROM app.vehicle_catalog_modifications AS item WHERE item.model_id = vehicle_catalog_models.id AND item.is_active)`,
        ),
      ]);
      const withModels = new Set(modelRows.rows.map((row) => row.make_id));
      const makes = makeViews(makeRows.rows.filter((row) => withModels.has(row.id)));
      const makeById = new Map(makes.map((make) => [make.id, make]));
      const seedModels = new Map(makes.map((make) => [make.id, VEHICLE_SEED.find((seed) => seed.slug === make.slug)?.models ?? []]));
      const modelById = new Map<number, CatalogPickerModel & { makeId: number }>();
      const modelsByMake = new Map<number, CatalogPickerModel[]>();
      const familyMap = new Map<string, Family>();
      for (const row of modelRows.rows) {
        const make = makeById.get(row.make_id);
        if (!make) continue;
        const view = modelView(row, seedModels.get(make.id) ?? []);
        modelById.set(view.id, { ...view, makeId: make.id });
        modelsByMake.set(make.id, [...(modelsByMake.get(make.id) ?? []), view]);
        const familyId = `${make.id}:${view.family.toLowerCase()}`;
        const family = familyMap.get(familyId) ?? { family: view.family, key: keyOf(view.family), make, models: [] };
        family.models.push(view);
        familyMap.set(familyId, family);
      }
      const snapshot: Snapshot = {
        at: Date.now() / 1000, families: [...familyMap.values()], makeById, makeBySlug: new Map(makes.map((make) => [make.slug, make])),
        makes, modelById, modelsByMake,
      };
      this.snapshot = snapshot;
      return snapshot;
    })().finally(() => { this.loading = null; });
    return this.loading;
  }

  /** Models of the makes the shop's own list knows, for the query reader (PartsFinderVehiclesService.vocabulary). */
  async knownFamilies(): Promise<Array<{ make: string; name: string }>> {
    const { families } = await this.load();
    return families.filter((family) => family.make.known).map((family) => ({ make: family.make.name, name: family.family }));
  }

  async makes(): Promise<{ groups: Array<{ letter: string; makes: CatalogPickerMake[] }>; popular: CatalogPickerMake[] }> {
    const { makes } = await this.load();
    const popular = makes.filter((make) => make.rank !== null).sort((a, b) => a.rank! - b.rank!).map(publicMake);
    const groups = new Map<string, CatalogPickerMake[]>();
    for (const make of [...makes].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }))) {
      const first = make.name[0]!.toUpperCase();
      const letter = /[A-Z]/u.test(first) ? first : /\d/u.test(first) ? "0–9" : first;
      groups.set(letter, [...(groups.get(letter) ?? []), publicMake(make)]);
    }
    return { groups: [...groups.entries()].map(([letter, list]) => ({ letter, makes: list })), popular };
  }

  async models(makeSlug: string): Promise<{ make: CatalogPickerMake; models: CatalogPickerModel[]; popular: string[]; source: "umapi" }> {
    const snapshot = await this.load();
    const make = snapshot.makeBySlug.get(makeSlug);
    if (!make) throw new PartsFinderError(404, "vehicle_make_not_found", "Марка не найдена. Выберите её из списка.");
    const models = [...(snapshot.modelsByMake.get(make.id) ?? [])]
      .sort((a, b) => a.family.localeCompare(b.family, "ru", { numeric: true, sensitivity: "base" }) || (b.yearFrom ?? 0) - (a.yearFrom ?? 0));
    const families = new Set(models.map((model) => model.family));
    const seed = VEHICLE_SEED.find((item) => item.slug === make.slug)?.models ?? [];
    return { make: publicMake(make), models, popular: seed.filter((name) => families.has(name)), source: "umapi" };
  }

  async modifications(modelId: number): Promise<{ available: boolean; message?: string; model: CatalogPickerModel; modifications: CatalogPickerModification[] }> {
    const snapshot = await this.load();
    const model = snapshot.modelById.get(modelId);
    if (!model) throw new PartsFinderError(404, "vehicle_model_not_found", "Модель не найдена. Выберите её из списка.");
    const result = await this.database.query<ModificationRowLike>(
      `SELECT id, name, capacity_l, power_ps, fuel_type, body_type, drive_type, produced_from, produced_to
       FROM app.vehicle_catalog_modifications WHERE model_id = $1 AND is_active`,
      [modelId],
    );
    const modifications = sortModifications(result.rows.map(modificationView));
    const { makeId: _makeId, ...view } = model;
    if (modifications.length > 0) return { available: true, model: view, modifications };
    return { available: false, message: "Для этого поколения в справочнике нет двигателей. Напишите нам VIN — подберём вручную.", model: view, modifications };
  }

  /**
   * Typeahead: makes and models (as families: «Toyota Corolla»), by name,
   * Russian spelling, wrong keyboard layout or one typo. A body code typed
   * along («королла e12») finds that generation itself.
   */
  async suggest(query: string): Promise<CatalogSuggestion[]> {
    const { families, makes } = await this.load();
    const tokens = new Set<string>();
    for (const token of normalizeQuery(query, CATEGORIES).tokens) tokens.add(token);
    for (const raw of words(query)) {
      for (const variant of [raw, ...words(toLatinLayout(raw)), ...words(toRussianLayout(raw)), ...phoneticLatin(raw)]) tokens.add(ALIASES[variant] ?? variant);
    }
    const list = [...tokens].filter((token) => token.length >= 2);
    if (list.length === 0) return [];
    const sounds = words(query).filter((word) => /^[а-я]{3,}$/u.test(word)).map((word) => phoneticKey(word)).filter((key) => key.length >= 3);
    const soundsLike = (part: string) => sounds.length > 0 && /^[a-z]{3,}$/u.test(part) && sounds.some((sound) => soundOf(part).startsWith(sound));
    const matches = (key: string) => {
      const parts = key.split(" ");
      return parts.some((part) => soundsLike(part)) || list.some((token) => parts.some((part) => part.startsWith(token) || (token.length >= 4 && oneTypo(token, part))));
    };
    // A name typed as written ranks above one that only sounds alike or has a typo («прадо» -> Prado before FJ Cruiser).
    // The more of the typed words a name holds, the higher it goes («прадо» is read as «land cruiser prado»).
    const closeness = (key: string) => {
      const parts = key.split(" ");
      const hits = list.filter((token) => parts.some((part) => part.startsWith(token))).length;
      if (hits > 0) return -Math.min(hits, 5) * 0.2;
      return parts.some((part) => soundsLike(part)) ? 1 : 2;
    };
    const makeKeys = (make: Family["make"]) => [keyOf(make.name), keyOf(make.slug.replaceAll("-", " ")), ...(make.nameRu ? [keyOf(make.nameRu)] : [])];
    const matchedMakes = makes.filter((make) => makeKeys(make).some(matches) || (ALIASES[make.slug] !== undefined && matches(ALIASES[make.slug]!)));
    const matchedIds = new Set(matchedMakes.map((make) => make.id));
    // «тойота кор»: a make named in full narrows the models to that make.
    const named = new Set(makes.filter((make) => makeKeys(make).some((key) => key !== "" && key.split(" ").every((part) => tokens.has(part)))).map((make) => make.id));
    const makeScore = (id: number) => (named.size > 0 ? (named.has(id) ? 0 : 20) : matchedIds.has(id) ? 0 : 10);
    const results: Array<CatalogSuggestion & { score: number }> = [];
    const codes = list.filter((token) => /\d/u.test(token) && /[a-z]/u.test(token));
    for (const family of families) {
      if (named.size > 0 && !named.has(family.make.id)) continue;
      const familyHit = matches(family.key);
      if (familyHit) {
        const single = family.models.length === 1 ? family.models[0]! : null;
        results.push({
          family: family.family, label: `${family.make.name} ${family.family}`, make: publicMake(family.make), model: single,
          score: makeScore(family.make.id) + closeness(family.key) + (family.make.rank ?? 50) / 100,
        });
      }
      if (codes.length > 0 && (familyHit || named.has(family.make.id))) {
        for (const model of family.models) {
          const generation = (model.generation ?? "").toLowerCase().split(/[\s·,/]+/u);
          if (!codes.some((code) => generation.includes(code))) continue;
          results.push({
            family: family.family, label: `${family.make.name} ${family.family} ${model.generation}`, make: publicMake(family.make), model,
            score: makeScore(family.make.id) - 1 + (family.make.rank ?? 50) / 100,
          });
        }
      }
    }
    for (const make of matchedMakes) {
      // «Toyota (FAW)», «VW (SVW)»: a joint-venture make is offered only when its partner is typed too.
      const partner = /\(([^)]*)\)/u.exec(make.name)?.[1];
      if (partner !== undefined && !matches(keyOf(partner))) continue;
      results.push({ label: make.name, make: publicMake(make), model: null, score: 5 + (make.rank ?? 50) / 100 });
    }
    return results
      .filter((item) => item.model !== null || item.family !== undefined || !results.some((other) => other.family && other.make.id === item.make.id))
      .sort((a, b) => a.score - b.score || a.label.localeCompare(b.label, "ru"))
      .slice(0, 10)
      .map(({ score: _score, ...item }) => item);
  }

  /**
   * «фильтр салона ауди а4», «колодки камри 70»: the car a search request names, read from our own catalog (no paid
   * call). A make must be named in full, a model by its name (in any layout, Russian spelling or transliteration);
   * without a make only a model name of four letters or more of a make the shop knows counts, so that a part's own
   * word never reads as a car. What remains is the part; a request without such a remainder is not one.
   */
  async understand(query: string): Promise<VehicleInQuery | null> {
    const { families, makes } = await this.load();
    const raw = words(query).slice(0, 12);
    if (raw.length < 2) return null;
    const variants = raw.map((word) => new Set([word, ...words(toLatinLayout(word)), ...phoneticLatin(word)].flatMap((item) => [item, ALIASES[item] ?? item])));
    const used = new Set<number>();
    const consume = (key: string): number[] | null => {
      const parts = key.split(" ").filter(Boolean);
      if (parts.length === 0) return null;
      const taken = new Set(used);
      const hit: number[] = [];
      for (const part of parts) {
        const index = variants.findIndex((set, position) => !taken.has(position) && set.has(part));
        if (index === -1) return null;
        hit.push(index);
        taken.add(index);
      }
      return hit;
    };
    const makeKeys = (make: MakeView) => [keyOf(make.name), keyOf(make.slug.replaceAll("-", " ")), ...(make.nameRu ? [keyOf(make.nameRu)] : [])];
    let make: { hit: number[]; view: MakeView } | null = null;
    for (const candidate of makes) {
      // «Toyota (FAW)»: a joint-venture make is never read from the plain name.
      if (/\(/u.test(candidate.name)) continue;
      for (const key of makeKeys(candidate)) {
        const hit = consume(key);
        if (hit && (!make || hit.length > make.hit.length || (hit.length === make.hit.length && (candidate.rank ?? 99) < (make.view.rank ?? 99)))) make = { hit, view: candidate };
      }
    }
    for (const index of make?.hit ?? []) used.add(index);
    let model: { family: Family; hit: number[] } | null = null;
    for (const family of families) {
      if (make ? family.make.id !== make.view.id : family.make.rank === null || family.key.replaceAll(" ", "").length < 4) continue;
      const hit = consume(family.key);
      if (hit && (!model || hit.length > model.hit.length || (hit.length === model.hit.length && (family.make.rank ?? 99) < (model.family.make.rank ?? 99)))) model = { family, hit };
    }
    if (!model) return null;
    for (const index of model.hit) used.add(index);
    // A body code, series or year typed along narrows the generations («a4 b8», «камри 70», «королла 2012»).
    let generations = model.family.models;
    for (let index = 0; index < raw.length; index += 1) {
      if (used.has(index) || !/\d/u.test(raw[index]!)) continue;
      const year = /^(19|20)\d{2}$/u.test(raw[index]!) ? Number(raw[index]) : null;
      const narrowed = generations.filter((item) => {
        if (year) return (item.yearFrom ?? 0) <= year && (item.yearTo ?? 9999) >= year;
        const names = words([item.bodyCode, item.series, item.generation].filter(Boolean).join(" "));
        return [...variants[index]!].some((variant) => names.includes(variant));
      });
      if (narrowed.length > 0) { generations = narrowed; used.add(index); }
    }
    const part = raw.filter((word, index) => !used.has(index) && !PART_STOP_WORDS.has(word));
    if (!part.some((word) => /^\p{L}{3,}$/u.test(word))) return null;
    return {
      family: model.family.family,
      label: `${model.family.make.name} ${model.family.family}`,
      make: publicMake(model.family.make),
      models: [...generations].sort((a, b) => (a.yearFrom ?? 0) - (b.yearFrom ?? 0)).slice(-10),
      part: part.join(" "),
    };
  }

  /**
   * What the guided search needs for a car picked in this catalog. Reads the
   * tables directly: a car kept in a garage stays readable after a new
   * edition hid its record.
   */
  async selected(input: { modelId?: number; modificationId?: number }): Promise<CatalogSelectedVehicle> {
    const invalid = () => new PartsFinderError(400, "invalid_vehicle", "Выберите автомобиль из списка заново.");
    let modification: ModificationRowLike & { model_id: number } | undefined;
    let modelId = input.modelId;
    if (input.modificationId) {
      modification = (await this.database.query<ModificationRowLike & { model_id: number }>(
        `SELECT id, model_id, name, capacity_l, power_ps, fuel_type, body_type, drive_type, produced_from, produced_to
         FROM app.vehicle_catalog_modifications WHERE id = $1`,
        [input.modificationId],
      )).rows[0];
      if (!modification) throw invalid();
      modelId = modification.model_id;
    }
    if (!modelId) throw invalid();
    const found = (await this.database.query<ModelRow & { make_name: string; make_umapi_id: number }>(
      `SELECT model.id, model.make_id, model.name, model.short_name, model.produced_from, model.produced_to,
              make.name AS make_name, make.umapi_id AS make_umapi_id
       FROM app.vehicle_catalog_models AS model JOIN app.vehicle_catalog_makes AS make ON make.id = model.make_id WHERE model.id = $1`,
      [modelId],
    )).rows[0];
    if (!found) throw invalid();
    const [make] = makeViews([{ id: found.make_id, name: found.make_name, umapi_id: found.make_umapi_id }]);
    const view = modelView(found, VEHICLE_SEED.find((seed) => seed.slug === make!.slug)?.models ?? []);
    const engine = modification ? modificationView(modification) : null;
    const years = [yearOf(modification?.produced_from ?? found.produced_from), yearOf(modification?.produced_to ?? found.produced_to)];
    return {
      capacity: engine?.capacity ?? null,
      engine: modification ? engineCodes(modification.name)[0] ?? null : null,
      fapiMakeId: null,
      fapiModelId: null,
      fapiModificationId: null,
      label: [make!.name, view.family, view.generation, engine?.label, years[0] ? `${years[0]}–${years[1] ?? "н. в."}` : null].filter(Boolean).join(" · "),
      make: make!.name,
      model: view.family,
    };
  }

  /** Size of the catalog and the last load, for the staff card. */
  async status(): Promise<VehicleCatalogStatus | null> {
    try {
      const counts = await this.database.query<{ makes: string; models: string; modifications: string }>(
        `SELECT (SELECT count(*) FROM app.vehicle_catalog_makes WHERE is_active)::text AS makes,
                (SELECT count(*) FROM app.vehicle_catalog_models WHERE is_active)::text AS models,
                (SELECT count(*) FROM app.vehicle_catalog_modifications WHERE is_active)::text AS modifications`,
      );
      const last = await this.database.query<{ changes: unknown; file_name: string; finished_at: Date; rows_rejected: number; rows_total: number }>(
        "SELECT file_name, rows_total, rows_rejected, changes, finished_at FROM app.vehicle_catalog_imports ORDER BY finished_at DESC LIMIT 1",
      );
      const row = counts.rows[0]!;
      const lastRow = last.rows[0];
      return {
        lastImport: lastRow ? {
          changes: lastRow.changes, fileName: lastRow.file_name, finishedAt: lastRow.finished_at.toISOString(),
          rowsRejected: lastRow.rows_rejected, rowsTotal: lastRow.rows_total,
        } : null,
        makes: Number(row.makes),
        models: Number(row.models),
        modifications: Number(row.modifications),
      };
    } catch {
      return null;
    }
  }
}
