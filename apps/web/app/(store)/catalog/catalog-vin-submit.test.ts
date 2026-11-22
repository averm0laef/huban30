import { describe, expect, it, vi } from "vitest";

import { EXPERT_HELP_VIN_STORAGE_KEY, submitCatalogVin } from "./catalog-vin-submit";

describe("catalog VIN submission", () => {
  it("stores a valid VIN and routes to specialist selection", () => {
    const saveVin = vi.fn();
    const navigate = vi.fn();

    expect(submitCatalogVin("  ZZZZZZZZZZZZZZZZZ ", { navigate, saveVin })).toBe(true);

    expect(saveVin).toHaveBeenCalledWith(EXPERT_HELP_VIN_STORAGE_KEY, "ZZZZZZZZZZZZZZZZZ");
    expect(navigate).toHaveBeenCalledWith("/expert-help");
  });

  it("still routes when session storage is unavailable", () => {
    const navigate = vi.fn();

    expect(submitCatalogVin("ZZZZZZZZZZZZZZZZZ", {
      navigate,
      saveVin: () => { throw new Error("storage unavailable"); },
    })).toBe(true);

    expect(navigate).toHaveBeenCalledWith("/expert-help");
  });

  it("leaves ordinary article and name searches to the GET form", () => {
    const saveVin = vi.fn();
    const navigate = vi.fn();

    expect(submitCatalogVin("oil filter", { navigate, saveVin })).toBe(false);
    expect(saveVin).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
