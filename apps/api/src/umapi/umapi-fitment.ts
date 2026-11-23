/**
 * Does a part fit the customer's car, and which cars it fits — from the
 * passenger cars UMAPI lists for it (ArticleLinks). Pure; the numbers are
 * those of our vehicle catalog (the UMAPI file: PCS_PC_ID = PC_ID, MS_ID).
 */
import type { UmapiCarLink } from "./umapi-normalize.js";

/** The same words as TecDoc's answer (product-fitment.tsx): fits / fits the model, another engine / the model only / not listed. */
export type UmapiVerdict = "fits" | "other_engine" | "model" | "not_listed";

export interface UmapiCar { msId: number | null; pcId: number | null }

export function verdictFor(links: readonly UmapiCarLink[], car: UmapiCar): UmapiVerdict {
  if (car.pcId !== null && links.some((link) => link.pcId === car.pcId)) return "fits";
  if (car.msId !== null && links.some((link) => link.msId === car.msId)) return car.pcId !== null ? "other_engine" : "model";
  return "not_listed";
}

/**
 * One answer from several parts: the product's own number decides alone; numbers read from its name decide only
 * when they all say the same, otherwise the answer is «не уверены» (null).
 */
export function combinedVerdict(answers: ReadonlyArray<{ verdict: UmapiVerdict; via: "own" | "name" }>): UmapiVerdict | null {
  const own = answers.find((answer) => answer.via === "own");
  if (own) return own.verdict;
  const verdicts = new Set(answers.map((answer) => answer.verdict));
  return verdicts.size === 1 ? [...verdicts][0]! : null;
}

export interface FitCar { mine: boolean; name: string; pcId: number }
export interface FitModel { cars: FitCar[]; mine: boolean; model: string; msId: number | null; yearFrom: number | null; yearTo: number | null }
export interface FitMake { make: string; mine: boolean; models: FitModel[] }

/** «К каким машинам подходит»: makes → models → engines, the customer's car marked and its make first. */
export function groupCars(links: readonly UmapiCarLink[], car: UmapiCar): { makes: FitMake[]; total: number } {
  const unique = new Map(links.map((link) => [link.pcId, link]));
  const makes = new Map<string, Map<string, FitModel>>();
  for (const link of unique.values()) {
    const models = makes.get(link.make) ?? new Map<string, FitModel>();
    const key = `${link.msId ?? link.model}`;
    const model = models.get(key) ?? { cars: [], mine: false, model: link.model, msId: link.msId, yearFrom: link.yearFrom, yearTo: link.yearTo };
    const mine = car.pcId !== null && link.pcId === car.pcId;
    model.cars.push({ mine, name: link.car, pcId: link.pcId });
    model.mine ||= mine || (car.msId !== null && link.msId === car.msId);
    if (link.yearFrom !== null && (model.yearFrom === null || link.yearFrom < model.yearFrom)) model.yearFrom = link.yearFrom;
    if (link.yearTo === null || model.yearTo === null) model.yearTo = null;
    else if (link.yearTo > model.yearTo) model.yearTo = link.yearTo;
    models.set(key, model);
    makes.set(link.make, models);
  }
  const list = [...makes.entries()].map(([make, models]): FitMake => {
    const sorted = [...models.values()]
      .map((model) => ({ ...model, cars: model.cars.sort((a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name, "ru", { numeric: true })) }))
      .sort((a, b) => Number(b.mine) - Number(a.mine) || a.model.localeCompare(b.model, "ru", { numeric: true }));
    return { make, mine: sorted.some((model) => model.mine), models: sorted };
  }).sort((a, b) => Number(b.mine) - Number(a.mine) || a.make.localeCompare(b.make, "ru"));
  return { makes: list, total: unique.size };
}
