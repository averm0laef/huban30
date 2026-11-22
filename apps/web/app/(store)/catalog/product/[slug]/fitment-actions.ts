import { FinderError } from "../../../_lib/parts-finder";
import type { ProductFitment } from "../../../_lib/tecdoc";

/** `check` — does it fit the customer's car; `list` — which cars it fits; `pick` — choose a car first. */
export type FitmentButton = "check" | "list" | "pick";
export type FitmentMode = Exclude<FitmentButton, "pick">;
export interface FitmentCar { genId?: number; msId?: number }

/**
 * The buttons of «Применимость», first the main one. Nothing is asked when the page opens: every catalogue request
 * is a button the customer pressed (docs/TECDOC.md). A car picked from the shop's own list has no catalogue ids.
 */
export function fitmentButtons(car: FitmentCar | null): FitmentButton[] {
  return car?.msId ? ["check", "list"] : ["list", "pick"];
}

export function fitmentQuery(mode: FitmentMode, car: FitmentCar | null): Record<string, number | string> {
  return {
    mode,
    ...(car?.msId ? { ms: car.msId } : {}),
    ...(mode === "check" && car?.msId && car.genId ? { gen: car.genId } : {}),
  };
}

function keptKey(productId: string, mode: FitmentMode, car: FitmentCar | null): string {
  return `an30:fitment:${productId}:${mode}:${car?.msId ?? "-"}:${mode === "check" ? car?.genId ?? "-" : "-"}`;
}

/** An answer kept for the rest of the visit (sessionStorage): a second press costs nothing. A display cache, not a copy. */
export function keptFitment(storage: Storage | null, productId: string, mode: FitmentMode, car: FitmentCar | null): ProductFitment | null {
  try {
    const raw = storage?.getItem(keptKey(productId, mode, car));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && "status" in value ? value as ProductFitment : null;
  } catch {
    return null;
  }
}

export function keepFitment(storage: Storage | null, productId: string, mode: FitmentMode, car: FitmentCar | null, answer: ProductFitment): void {
  try {
    storage?.setItem(keptKey(productId, mode, car), JSON.stringify(answer));
  } catch {
    // A full or forbidden storage only costs the customer a repeated request.
  }
}

/** Too many checks today (the catalogue's or the visitor's share): a specialist checks by VIN instead. */
export function fitmentFailure(error: unknown): "expert" | "unavailable" {
  return error instanceof FinderError && error.status === 429 ? "expert" : "unavailable";
}
