import { EXPERT_HELP_VIN_STORAGE_KEY, isValidVin } from "../_lib/vin";

export { EXPERT_HELP_VIN_STORAGE_KEY } from "../_lib/vin";

export interface CatalogVinSubmitActions {
  navigate: (path: string) => void;
  saveVin: (key: string, value: string) => void;
}

/** Routes a VIN to specialist selection while leaving normal catalog searches alone. */
export function submitCatalogVin(query: string, actions: CatalogVinSubmitActions): boolean {
  const vin = query.trim();
  if (!isValidVin(vin)) return false;

  try {
    actions.saveVin(EXPERT_HELP_VIN_STORAGE_KEY, vin.toUpperCase());
  } catch {
    // Storage may be disabled; the specialist form remains usable without prefill.
  }
  actions.navigate("/expert-help");
  return true;
}
