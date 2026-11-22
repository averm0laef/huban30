import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { FapiBudget, moscowDay } from "./engine/fapi-budget.js";
import { findPart, readUsage, type FapiGateway, type FapiUsage } from "./engine/fapi.js";
import { PartsFinderError } from "./engine/errors.js";
import { requestJson, type RequestJson } from "./engine/http.js";
import type { VehicleVocabulary } from "./engine/part-query.js";
import { VehicleIdentity } from "./engine/vehicle-identity.js";
import { searchVehicleParts, type SearchForm, type SearchResult } from "./engine/vehicle-parts.js";
import { RedisFapiVisitorShares } from "./fapi-visitor-shares.js";
import { PgFapiLedgerStore, PgFitmentStore, PgVehicleStore } from "./parts-finder.stores.js";

/**
 * Who a paid lookup is for: a visitor's address, counted against that visitor's share of the day, or `null` for
 * the shop's own work (staff, background runs). Never optional — every caller has to decide.
 */
export type FapiPayer = string | null;

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
    visitorShares: RedisFapiVisitorShares,
    @Optional() @Inject(PARTS_FINDER_HTTP) private readonly http: RequestJson = defaultPartsFinderHttp,
  ) {
    this.http = http ?? defaultPartsFinderHttp;
    this.budget = new FapiBudget(ledger, {
      dailyLimit: () => this.dailyLimit,
      key: () => this.fapiKey,
      requestJson: (url, options) => this.http(url, options),
      visitors: { limit: () => this.visitorDailyLimit, shares: visitorShares },
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

  /** One visitor's share of the day's credits. */
  get visitorDailyLimit(): number {
    return this.config.get<number>("FAPI_VISITOR_DAILY_CREDIT_LIMIT") ?? 100;
  }

  /** The paid catalogue for this payer: what it costs is counted against the visitor's share, or the shop's. */
  fapiFor(payer: FapiPayer): FapiGateway {
    return payer === null ? this.budget : this.budget.forVisitor(payer);
  }

  /** `offline`: answer from the shop's own fitment only, without the paid catalogue. */
  search(form: SearchForm, vocabulary: VehicleVocabulary | undefined, options: { offline?: boolean; payer: FapiPayer }): Promise<SearchResult> {
    return searchVehicleParts(form, {
      fapi: this.fapiFor(options.payer), fapiFitmentEnabled: this.fapiFitmentEnabled && !options.offline, fitment: this.fitment,
      ...(vocabulary ? { vocabulary } : {}),
    });
  }

  crosses(form: { article: string; manufacturer_id?: number }, payer: FapiPayer): Promise<Record<string, unknown>> {
    return findPart(form, this.fapiFor(payer));
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
