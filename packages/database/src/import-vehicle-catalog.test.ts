import { describe, expect, it } from "vitest";

import { retireRefusal } from "./import-vehicle-catalog.js";

describe("retireRefusal", () => {
  it("lets the first load and a small cleanup through", () => {
    expect(retireRefusal(0, 0, false)).toBeNull();
    expect(retireRefusal(90_000, 9_000, false)).toBeNull();
  });

  it("stops a file that would hide more than a tenth of the catalog unless allowed", () => {
    expect(retireRefusal(90_000, 9_001, false)).toMatch(/--allow-retire/u);
    expect(retireRefusal(90_000, 80_000, true)).toBeNull();
  });
});
