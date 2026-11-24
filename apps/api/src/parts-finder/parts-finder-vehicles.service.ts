import { Injectable, Logger } from "@nestjs/common";

import { DatabaseService } from "../infrastructure/database.service.js";
import { PartsFinderError } from "./engine/errors.js";
import { EMPTY_VOCABULARY, buildVehicleVocabulary, type VehicleVocabulary } from "./engine/part-query.js";
import { VEHICLE_SEED } from "./engine/vehicle-seed.js";
import { VehicleCatalogService, type VehicleCatalogStatus } from "./vehicle-catalog.service.js";

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
  bodyCode?: string | null;
  series?: string | null;
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
  /** «передний привод». */
  drive?: string | null;
  engine: string | null;
  fuel?: string | null;
  id: number;
  label: string;
  /** «1.4 л (L08, L68)», «530 d xDrive». */
  name?: string;
  powerPs?: number | null;
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

const EMPTY_CATALOG = "Список автомобилей пока не загружен. Напишите марку и модель в поиске деталей — подберём.";

/**
 * Make -> model -> modification picker of /podbor, «Мой авто» and the garage,
 * and the car names the query reader knows. Everything comes from the UMAPI
 * passenger-car catalog (VehicleCatalogService, docs/UMAPI.md): choosing a car
 * costs no paid request. The former list filled from FAPI
 * (app.parts_finder_vehicle_*) was removed by migration 0057.
 */
@Injectable()
export class PartsFinderVehiclesService {
  private readonly logger = new Logger(PartsFinderVehiclesService.name);
  private vocabularyCache: { at: number; value: VehicleVocabulary } | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly catalog: VehicleCatalogService,
  ) {}

  /** The catalog is loaded (the last known state; refreshed in the background). */
  get usesCatalog(): boolean {
    return this.catalog.readyHint;
  }

  private async loaded(): Promise<void> {
    if (!await this.catalog.ready()) throw new PartsFinderError(503, "vehicle_catalog_empty", EMPTY_CATALOG);
  }

  /**
   * Car names for the query reader («гайя» -> Toyota Gaia): the makes of the
   * shop's own list (vehicle-seed.ts) with their catalog models. Rare makes of
   * the catalog stay out: «газель» must stay a GAZ, not a Hillman. Names of
   * the brands we sell stay brands («сакура» is a filter maker here, not the
   * Nissan). Never fails a search: on any error the built-in list is used.
   */
  async vocabulary(): Promise<VehicleVocabulary> {
    if (this.vocabularyCache && Date.now() / 1000 - this.vocabularyCache.at < SNAPSHOT_SECONDS) return this.vocabularyCache.value;
    try {
      const [families, brands] = await Promise.all([
        this.catalog.ready().then((ready) => (ready ? this.catalog.knownFamilies() : [])),
        this.database.query<{ name: string }>("SELECT name FROM app.brands WHERE is_active AND deleted_at IS NULL"),
      ]);
      const value = buildVehicleVocabulary({
        exclude: brands.rows.map((row) => row.name),
        makes: VEHICLE_SEED.map((make) => ({ name: make.name, nameRu: make.nameRu })),
        models: [...VEHICLE_SEED.flatMap((make) => make.models.map((name) => ({ make: make.name, name }))), ...families],
      });
      this.vocabularyCache = { at: Date.now() / 1000, value };
      return value;
    } catch (error) {
      this.logger.warn(`vehicle vocabulary unavailable: ${error instanceof Error ? error.name : "unknown"}`);
      return EMPTY_VOCABULARY;
    }
  }

  async makes(): Promise<{ groups: Array<{ letter: string; makes: PickerMake[] }>; popular: PickerMake[] }> {
    await this.loaded();
    return this.catalog.makes();
  }

  async models(makeSlug: string): Promise<{ make: PickerMake; models: PickerModel[]; popular: string[]; source: "umapi" }> {
    await this.loaded();
    return this.catalog.models(makeSlug);
  }

  async modifications(modelId: number): Promise<{ available: boolean; message?: string; model: PickerModel; modifications: PickerModification[] }> {
    await this.loaded();
    return this.catalog.modifications(modelId);
  }

  /** Typeahead over make and model names: aliases, wrong keyboard layout and single typos. */
  async suggest(query: string): Promise<Array<{ family?: string; label: string; make: PickerMake; model: PickerModel | null }>> {
    if (!await this.catalog.ready()) return [];
    return this.catalog.suggest(query);
  }

  /** «фильтр салона ауди а4»: the car a search request names and its part (our own catalog only). */
  async understand(query: string) {
    if (!await this.catalog.ready()) return null;
    return this.catalog.understand(query);
  }

  /**
   * What the guided search needs for a picked car. A car picked in the former
   * list (an id under CATALOG_ID_BASE, kept in a browser or a garage from
   * before the switch) no longer exists: the customer picks it again.
   */
  async selected(input: { modelId?: number; modificationId?: number }): Promise<SelectedVehicle> {
    if (!this.catalog.owns(input)) throw new PartsFinderError(400, "invalid_vehicle", "Выберите автомобиль из списка заново.");
    return this.catalog.selected(input);
  }

  /** Size of the catalog and its last load, for the staff card. */
  async catalogStatus(): Promise<{ umapi: VehicleCatalogStatus | null }> {
    return { umapi: await this.catalog.status() };
  }
}
