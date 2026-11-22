import { existsSync } from "node:fs";
import path from "node:path";

import { STOREFRONT_TAXONOMY, storefrontSectionImage, type CatalogCategoryNode } from "@an30/contracts";
import { describe, expect, it } from "vitest";

import { catalogDrawerSections, catalogMenuSections, catalogSectionTiles, publicSectionName, sectionLink } from "./store-categories";

const categoriesDir = path.join(__dirname, "..", "..", "..", "public", "categories");

describe("pictures of the catalogue tree", () => {
  it("has a file for every picture the tree names", () => {
    const named = STOREFRONT_TAXONOMY.flatMap((section) => [section.image, ...section.children.map((child) => child.image)])
      .filter((image): image is string => Boolean(image));
    expect(named.filter((image) => !existsSync(path.join(categoriesDir, `${image}.webp`)))).toEqual([]);
  });

  it("gives every section its own picture, and a subsection without one the section's", () => {
    expect(STOREFRONT_TAXONOMY.filter((section) => !section.image).map((section) => section.slug)).toEqual([]);
    expect(storefrontSectionImage("podveska")).toBe("podveska");
    expect(storefrontSectionImage("amortizatory")).toBe("podveska");
    expect(storefrontSectionImage("maslyanye-filtry")).toBe("maslyanye-filtry");
    expect(storefrontSectionImage("no-such-section")).toBeNull();
  });
});

function node(slug: string, name: string, productCount: number, children: CatalogCategoryNode[] = []): CatalogCategoryNode {
  return { children, description: null, id: `00000000-0000-4000-8000-${String(productCount).padStart(12, "0")}`, name, productCount, slug, sortOrder: 0 };
}

describe("the section tiles of /catalog", () => {
  // The page used to show eight tiles written into the code, whatever the catalogue held: the suspension, the
  // engine and seventeen other sections of the owner's base had no tile at all.
  const tree = [
    node("motornye-masla", "Моторные масла", 1331),
    node("podveska", "Подвеска", 7471, [node("amortizatory", "Амортизаторы и стойки", 900)]),
    node("bez-kategorii", "Без категории", 2024),
    node("shlangi-i-fitingi", "Шланги, фитинги, РВД", 639),
  ];

  it("shows every section the catalogue holds, in the catalogue's own order", () => {
    expect(catalogSectionTiles(tree).map((tile) => tile.key)).toEqual(["motornye-masla", "podveska", "shlangi-i-fitingi", "bez-kategorii"]);
  });

  it("links a tile to its section and gives it the section's picture", () => {
    expect(catalogSectionTiles(tree)[1]).toEqual({ href: "/catalog/podveska", image: "/categories/podveska.webp", key: "podveska", label: "Подвеска" });
  });

  it("puts the goods that have no section yet last, under a name a customer understands, without a picture", () => {
    expect(catalogSectionTiles(tree).at(-1)).toEqual({ href: "/catalog/bez-kategorii", image: null, key: "bez-kategorii", label: "Другие товары" });
  });

  it("falls back to the main sections as searches when the catalogue did not answer", () => {
    const tiles = catalogSectionTiles([]);

    expect(tiles).toHaveLength(8);
    expect(tiles[0]).toEqual({ href: "/catalog?q=%D0%BC%D0%BE%D1%82%D0%BE%D1%80%D0%BD%D0%BE%D0%B5+%D0%BC%D0%B0%D1%81%D0%BB%D0%BE", image: "/categories/motornye-masla.webp", key: "motornye-masla", label: "Моторные масла" });
  });
});

describe("the name a customer sees for a section", () => {
  it("is the section's own name", () => {
    expect(publicSectionName({ name: "Подвеска", slug: "podveska" })).toBe("Подвеска");
  });

  it("is «Другие товары» for the staff's queue «Без категории»", () => {
    expect(publicSectionName({ name: "Без категории", slug: "bez-kategorii" })).toBe("Другие товары");
  });
});

describe("the catalogue menu of the header and of the phone drawer", () => {
  // The header's «Каталог» was a bare link and the phone drawer listed eight sections written into the code, some
  // of which the catalogue did not hold (a 404) while the parts sections were missing.
  const tree = [
    node("motornye-masla", "Моторные масла", 1331, [node("sinteticheskie-motornye-masla", "Синтетические", 400)]),
    node("bez-kategorii", "Без категории", 2024),
    node("podveska", "Подвеска", 7471, [node("amortizatory", "Амортизаторы и стойки", 900), node("pruzhiny", "Пружины", 120)]),
  ];

  it("lists every section the catalogue holds with its subsections, the goods without a section last", () => {
    expect(catalogMenuSections(tree)).toEqual([
      {
        children: [{ href: "/catalog/motornye-masla/sinteticheskie-motornye-masla", key: "sinteticheskie-motornye-masla", label: "Синтетические" }],
        href: "/catalog/motornye-masla", image: "/categories/motornye-masla.webp", key: "motornye-masla", label: "Моторные масла",
      },
      {
        children: [
          { href: "/catalog/podveska/amortizatory", key: "amortizatory", label: "Амортизаторы и стойки" },
          { href: "/catalog/podveska/pruzhiny", key: "pruzhiny", label: "Пружины" },
        ],
        href: "/catalog/podveska", image: "/categories/podveska.webp", key: "podveska", label: "Подвеска",
      },
      { children: [], href: "/catalog/bez-kategorii", image: null, key: "bez-kategorii", label: "Другие товары" },
    ]);
  });

  it("is empty when the catalogue did not answer: the menu then stays a plain link to /catalog", () => {
    expect(catalogMenuSections([])).toEqual([]);
  });
});

describe("links to sections when the catalogue did not answer or does not hold the section", () => {
  // The phone drawer and the footer used to link to /catalog/<section> whatever the catalogue held: with no
  // catalogue behind the storefront (or an empty one before the first 1С exchange) those pages do not exist.
  const menu = catalogMenuSections([node("podveska", "Подвеска", 7471, [node("pruzhiny", "Пружины", 120)])]);

  it("lists the main sections as searches in the phone drawer", () => {
    const sections = catalogDrawerSections([]);

    expect(sections).toHaveLength(8);
    expect(sections[1]).toEqual({ children: [], href: "/catalog?q=%D1%84%D0%B8%D0%BB%D1%8C%D1%82%D1%80", image: "/categories/filtry.webp", key: "filtry", label: "Фильтры" });
  });

  it("shows the catalogue's own menu in the drawer when there is one", () => {
    expect(catalogDrawerSections(menu)).toBe(menu);
  });

  it("opens a named section when the catalogue holds it", () => {
    expect(sectionLink(menu, "podveska")).toBe("/catalog/podveska");
  });

  it("searches by the section's word when the catalogue does not hold it", () => {
    expect(sectionLink(menu, "filtry")).toBe("/catalog?q=%D1%84%D0%B8%D0%BB%D1%8C%D1%82%D1%80");
    expect(sectionLink([], "tormoznaya-sistema")).toBe("/catalog?q=%D1%82%D0%BE%D1%80%D0%BC%D0%BE%D0%B7");
  });

  it("falls back to the whole catalogue for a section it has no word for", () => {
    expect(sectionLink([], "no-such-section")).toBe("/catalog");
  });
});
