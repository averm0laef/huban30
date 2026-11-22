import { describe, expect, it } from "vitest";

import { catalogHrefForFinder } from "./parts-finder";

describe("catalogHrefForFinder", () => {
  it("opens the part's section and carries the car", () => {
    expect(catalogHrefForFinder("Топливный фильтр", "Toyota Gaia", "топливный gaia"))
      .toBe("/catalog/filtry/toplivnye-filtry?vehicle=Toyota+Gaia");
  });

  it("searches the part name, not the raw query, when there is no section", () => {
    expect(catalogHrefForFinder("Амортизатор", "Toyota Gaia", "амортизатор гайя")).toBe("/catalog?vehicle=Toyota+Gaia&q=%D0%90%D0%BC%D0%BE%D1%80%D1%82%D0%B8%D0%B7%D0%B0%D1%82%D0%BE%D1%80");
    expect(catalogHrefForFinder(undefined, undefined, "фильтр")).toBe("/catalog?q=%D1%84%D0%B8%D0%BB%D1%8C%D1%82%D1%80");
  });
});
