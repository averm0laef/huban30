import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { FapiBudget, moscowDay } from "./engine/fapi-budget.js";
import { findPart, readUsage, type FapiGateway, type FapiUsage } from "./engine/fapi.js";
import { PartsFinderError } from "./engine/errors.js";
import { requestJson, type RequestJson } from "./engine/http.js";
import type { VehicleVocabulary } from "./engine/part-query.js";
import { VehicleIdentity } from "./engine/vehicle-identity.js";
import { searchVehicleParts, type SearchForm, type SearchResult } from "./engine/vehicle-parts.js";
import { PgFapiLedgerStore, PgFitmentStore, PgVehicleStore } from "./parts-finder.stores.js";

/** Replaceable outbound HTTP (tests inject a fake; nothing paid is ever called from tests). */
export const PARTS_FINDER_HTTP = Symbol("PARTS_FINDER_HTTP");
export const defaultPartsFinderHttp: RequestJson = requestJson;

/**
 * The parts-finder logic wired to АН-30 configuration and PostgreSQL:
 * guided search, FAPI crosses through the shared credit ledger, VIN and
 * chassis decoding.
 */
@Injectable()
export class PartsFinderEngine {
  readonly budget: FapiBudget;
  readonly identity: VehicleIdentity;

  constructor(
    private readonly config: ConfigService,
    readonly ledger: PgFapiLedgerStore,
    private readonly fitment: PgFitmentStore,
    readonly vehicles: PgVehicleStore,
    @Optional() @Inject(PARTS_FINDER_HTTP) private readonly http: RequestJson = defaultPartsFinderHttp,
  ) {
    this.http = http ?? defaultPartsFinderHttp;
    this.budget = new FapiBudget(ledger, {
      dailyLimit: () => this.dailyLimit,
      key: () => this.fapiKey,
      requestJson: (url, options) => this.http(url, options),
    });
    this.identity = new VehicleIdentity({
      ninjasKey: () => this.config.get<string>("API_NINJAS_KEY"),
      ninjasMode: () => this.config.get<string>("API_NINJAS_MODE") ?? "off",
      requestJson: (url, options) => this.http(url, options),
      store: vehicles,
    });
  }

  get enabled(): boolean {
    return this.config.get<boolean>("PARTS_FINDER_ENABLED") ?? true;
  }

  get fapiKey(): string | undefined {
    return this.config.get<string>("FAPI_KEY") || undefined;
  }

  get fapiFitmentEnabled(): boolean {
    return this.config.get<boolean>("FAPI_FITMENT_ENABLED") ?? false;
  }

  get dailyLimit(): number {
    return this.config.get<number>("FAPI_DAILY_CREDIT_LIMIT") ?? 1_000;
  }

  get fapi(): FapiGateway {
    return this.budget;
  }

  /** `offline`: answer from the shop's own fitment only, without the paid catalogue. */
  search(form: SearchForm, vocabulary?: VehicleVocabulary, options: { offline?: boolean } = {}): Promise<SearchResult> {
    return searchVehicleParts(form, {
      fapi: this.budget, fapiFitmentEnabled: this.fapiFitmentEnabled && !options.offline, fitment: this.fitment,
      ...(vocabulary ? { vocabulary } : {}),
    });
  }

  crosses(form: { article: string; manufacturer_id?: number }): Promise<Record<string, unknown>> {
    return findPart(form, this.budget);
  }

  vehicle(vin: string): Promise<Record<string, unknown>> {
    return this.identity.identify(vin);
  }

  async usage(): Promise<FapiUsage> {
    if (!this.fapiKey) throw new PartsFinderError(503, "fapi_key_missing", "Ключ FAPI не настроен.");
    return readUsage(this.fapiKey, (url, options) => this.http(url, options));
  }

  today(): string {
    return moscowDay(Date.now() / 1000);
  }
}
