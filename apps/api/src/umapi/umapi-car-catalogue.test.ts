// «Каталог запчастей по машине»: shapes follow the answers of the owner's key (Audi A4 B8 1.8 TFSI, PC 25456,
// 24.11.2026); values are cut down. No paid call: the gateway is a stand-in.
import type { ShopOffer } from "@an30/contracts";
import { describe, expect, it } from "vitest";

import type { DatabaseService } from "../infrastructure/database.service.js";
import type { PartsFinderShopService, ShopOfferRequest } from "../parts-finder/parts-finder-shop.service.js";
import { mainPartType, matchCarCategories, normalizeCarArticles, normalizeCarCatalogue, normalizePartTypes } from "./umapi-car-catalogue.js";
import { UmapiCarCatalogueService } from "./umapi-car-catalogue.service.js";
import type { UmapiGateway } from "./umapi.gateway.js";

const CATEGORIES = {
  quic: [
    { CATEGORY_IDS: [100005], DES: "Фильтр", QSI_ID: 5, QSI_IMG: "TECDOC_SC_FILTER_G.GIF" },
    { CATEGORY_IDS: [100006], DES: "Тормозная система", QSI_ID: 9, QSI_IMG: "x.GIF" },
    { CATEGORY_IDS: [999999], DES: "Пустая группа", QSI_ID: 40 },
  ],
  root: [
    { CATEGORY_ID: 100005, CHILD: [{ CATEGORY_ID: 100259, DES: "Масляный фильтр" }, { CATEGORY_ID: 100263, DES: "Фильтр салона" }], DES: "Фильтр" },
    { CATEGORY_ID: 100006, CHILD: [{ CATEGORY_ID: 100029, CHILD: [{ CATEGORY_ID: 100030, DES: "Тормозная колодка" }], DES: "Дисковой тормозной механизм" }], DES: "Тормозная система" },
    { CATEGORY_ID: 100340, CHILD: [{ CATEGORY_ID: 100346, DES: "Фильтр салона" }], DES: "Отопление / вентиляция" },
  ],
};
const article = (artId: number, nr: string, brand: string, extra: Record<string, unknown> = {}) => ({
  ART_ID: artId, ARTICLE_NR: nr, BRAND: brand, COMPLETE_DES: "Фильтр, воздух во внутренном пространстве", SUP_ID: 4814,
  CRITERIAS: [{ CRI_DES: "Длина [мм]", CRI_UNIT_DES: "мм", DES: null, VALUE: "279" }, { CRI_DES: "Исполнение фильтра", DES: "Частичный фильтр", VALUE: "21" }],
  MEDIAS: [{ FILE_NAME: `${nr}.webp`, SORT: 1, SUP_ID: 4814 }], ...extra,
});

describe("UMAPI car catalogue rules", () => {
  it("names the quick sections as customers say them, drops empty ones, keeps the tree", () => {
    const catalogue = normalizeCarCatalogue(CATEGORIES);
    expect(catalogue.groups.map((group) => [group.name, group.hint])).toEqual([
      ["Фильтры", "масляный, воздушный, салона, топливный"],
      ["Тормоза", "колодки, диски, суппорты, шланги"],
    ]);
    expect(catalogue.tree).toHaveLength(3);
  });

  it("finds the categories a request names, once each, by its words and the usual synonyms", () => {
    const { tree } = normalizeCarCatalogue(CATEGORIES);
    expect(matchCarCategories(tree, "фильтр салона").map((match) => match.id)).toEqual([100263]);
    expect(matchCarCategories(tree, "салонный фильтр").map((match) => match.id)).toEqual([100263]);
    expect(matchCarCategories(tree, "колодки").map((match) => [match.id, match.path])).toEqual([[100030, ["Тормоза", "Дисковой тормозной механизм"]]]);
    expect(matchCarCategories(tree, "для")).toEqual([]);
  });

  it("suggests only related systems for pressure when no exact category exists", () => {
    const tree = [
      { id: 21, name: "Система смазки", children: [{ id: 22, name: "Масляный насос", children: [] }] },
      { id: 23, name: "Топливная система", children: [{ id: 24, name: "Топливный насос", children: [] }] },
      { id: 25, name: "Расходники", children: [{ id: 26, name: "Свечи", children: [] }] },
    ];
    expect(matchCarCategories(tree, "Давления").map(({ id, related }) => ({ id, related })))
      .toEqual([{ id: 21, related: true }, { id: 23, related: true }]);
    expect(matchCarCategories(tree, "давление топлива").map(({ id }) => id)).toEqual([23]);
    expect(matchCarCategories([...tree, { id: 27, name: "Датчик давления топлива", children: [] }], "давление топлива"))
      .toEqual([{ id: 27, leaf: true, name: "Датчик давления топлива", path: [] }]);
  });

  it("puts a part type the catalogue names as a list of words the way customers say it", () => {
    expect(normalizePartTypes([{ PRODUCT: "Фильтр, воздух во внутренном пространстве", PT_ID: 424 }, { PRODUCT: "Фильтр, воздух во внутренном пространстве", PT_ID: 424 }]))
      .toEqual([{ id: 424, name: "Фильтр салона", original: "Фильтр, воздух во внутренном пространстве" }]);
  });

  it("opens the part a section means, not its sensor; asks when two are alike", () => {
    const types = normalizePartTypes([
      { PRODUCT: "Датчик, износ тормозных колодок", PT_ID: 1 },
      { PRODUCT: "Тормозные колодки, дисковый тормоз", PT_ID: 402 },
      { PRODUCT: "Сигнализатор, износ тормозных колодок", PT_ID: 3 },
    ]);
    expect(mainPartType(types, "Тормозная колодка")?.id).toBe(402);
    const twins = normalizePartTypes([{ PRODUCT: "Рычаг подвески передний", PT_ID: 5 }, { PRODUCT: "Рычаг подвески задний", PT_ID: 6 }]);
    expect(mainPartType(twins, "Рычаг подвески")).toBeNull();
  });

  it("reads a page of parts with its total, sizes and the first picture", () => {
    const page = normalizeCarArticles({ data: [article(1, "CUK2939", "MANN-FILTER"), { ART_ID: 2 }], limit: 100, offset: 0, rows: 404 });
    expect(page.total).toBe(404);
    expect(page.articles).toEqual([{
      artId: 1, article: "CUK2939", brand: "MANN-FILTER", criteria: [{ name: "Длина", value: "279 мм" }, { name: "Исполнение фильтра", value: "Частичный фильтр" }],
      medias: [{ file: "CUK2939.webp", supId: 4814 }], name: "Фильтр салона",
    }]);
  });
});

function offer(brand: string, sku: string, available: number, matchedVia: ShopOffer["matchedVia"] = "exact"): ShopOffer {
  return { availableQuantity: available, brand, matchedVia, name: `Фильтр салона ${brand} ${sku}`, priceKopeks: 145000, productId: `${brand}-${sku}`, sku, slug: sku.toLowerCase() };
}

function service(options: { offers?: Record<string, ShopOffer[]>; rows?: number; types?: unknown[] } = {}) {
  const calls: string[] = [];
  const pages: Record<number, unknown[]> = {
    0: [article(1, "C30317", "1A FIRST AUTOMOTIVE"), article(2, "CUK2939", "MANN-FILTER"), article(3, "K1149", "FILTRON")],
    100: [article(4, "LAK386", "MAHLE"), article(5, "E2945LI", "HENGST FILTER")],
  };
  const gateway = {
    get: async (path: string, parameters: Record<string, unknown>, _caller: unknown, reduce: (payload: unknown) => unknown) => {
      calls.push(`${path}${parameters.offset !== undefined ? `@${String(parameters.offset)}` : ""}`);
      if (path === "/Categories") return reduce(CATEGORIES);
      if (path === "/Products/one") return reduce(options.types ?? [{ PRODUCT: "Фильтр, воздух во внутренном пространстве", PT_ID: 424 }]);
      if (path === "/Articles") return reduce({ data: pages[Number(parameters.offset)] ?? [], rows: options.rows ?? 5 });
      throw new Error(`unexpected ${path}`);
    },
    mediaBaseUrl: "https://image.example/IMAGE",
  };
  const database = {
    query: async (sql: string, values?: unknown[]) => {
      if (sql.includes("vehicle_catalog_modifications")) return { rows: values?.[0] === 100000777 ? [{ pc: 25456 }] : [] };
      if (sql.includes("DISTINCT brand.name")) return { rows: [{ name: "FILTRON" }, { name: "1A FIRST AUTOMOTIVE" }] };
      return { rows: [{ alias: "MANN", canonical: "MANNFILTER" }] };
    },
  };
  const shop = { lookup: async () => ({ for: (request: ShopOfferRequest) => options.offers?.[`${request.brand}|${request.article}`] ?? [] }) };
  const instance = new UmapiCarCatalogueService(gateway as unknown as UmapiGateway, shop as unknown as PartsFinderShopService, database as unknown as DatabaseService);
  return { calls, instance };
}

const visitor = { ip: "203.0.113.5", userId: null };

describe("UmapiCarCatalogueService", () => {
  it("opens a car of our vehicle catalog by its UMAPI number and answers a typed request from the same tree", async () => {
    const { calls, instance } = service();
    const answer = await instance.categories(100000777, "фильтр салона", visitor);
    expect(answer.status).toBe("ok");
    expect(answer.status === "ok" && answer.matches.map((match) => match.id)).toEqual([100263]);
    expect(calls).toEqual(["/Categories"]);
    expect(await instance.categories(1, undefined, visitor)).toEqual({ status: "unknown_car" });
  });

  it("lists our products first, in stock before on order; the same number of another maker is not ours", async () => {
    const { instance } = service({
      offers: {
        "MANN-FILTER|CUK2939": [offer("MANN", "CUK 2939", 6)],
        "FILTRON|K1149": [offer("FILTRON", "K1149", 0)],
        "1A FIRST AUTOMOTIVE|C30317": [offer("SAKURA", "C30317", 3)],
      },
    });
    const answer = await instance.parts({ categoryId: 100263, modificationId: 100000777, page: 1 }, visitor);
    expect(answer.status).toBe("ok");
    if (answer.status !== "ok") return;
    expect(answer.type.name).toBe("Фильтр салона");
    expect(answer.ours.map((part) => part.article)).toEqual(["CUK2939", "K1149"]);
    expect(answer.ours[0]!.image).toBe("https://image.example/IMAGE/4814/CUK2939.webp");
    expect(answer.catalogue.map((part) => part.article)).toEqual(["C30317"]);
    expect(answer.category.path).toEqual(["Фильтры"]);
  });

  it("asks every page of a long list — at most ten — and pages the rest by thirty, filtered by brand", async () => {
    const { calls, instance } = service({ rows: 1404 });
    const answer = await instance.parts({ brand: "MAHLE", categoryId: 100263, modificationId: 100000777, page: 1 }, visitor);
    expect(calls.filter((call) => call.startsWith("/Articles"))).toEqual(Array.from({ length: 10 }, (_, index) => `/Articles@${index * 100}`));
    if (answer.status !== "ok") throw new Error(answer.status);
    expect(answer.catalogue.map((part) => part.brand)).toEqual(["MAHLE"]);
    expect(answer.total).toBe(1404);
    expect(answer.truncated).toBe(true);
  });

  it("lists makers customers know first, then makers we sell, then the rest — not by the alphabet", async () => {
    const { instance } = service({ rows: 120 });
    const answer = await instance.parts({ categoryId: 100263, modificationId: 100000777, page: 1 }, visitor);
    if (answer.status !== "ok") throw new Error(answer.status);
    expect(answer.catalogue.map((part) => part.brand)).toEqual(["MANN-FILTER", "MAHLE", "FILTRON", "HENGST FILTER", "1A FIRST AUTOMOTIVE"]);
    expect(answer.brands.map((brand) => brand.name)).toEqual(["MANN-FILTER", "MAHLE", "FILTRON", "HENGST FILTER", "1A FIRST AUTOMOTIVE"]);
  });

  it("offers the part types of a category that holds several, and opens the chosen one", async () => {
    const types = [{ PRODUCT: "Масляный фильтр", PT_ID: 7 }, { PRODUCT: "Прокладка, маслянный фильтр", PT_ID: 133 }, { PRODUCT: "Масляный фильтр, дифференциал", PT_ID: 3502 }];
    const { instance } = service({ types });
    // The category is named as one of its types: that one opens.
    expect((await instance.parts({ categoryId: 100259, modificationId: 100000777, page: 1 }, visitor)).status).toBe("ok");
    const chosen = await instance.parts({ categoryId: 100030, modificationId: 100000777, page: 1 }, visitor);
    expect(chosen.status).toBe("choose_type");
    expect((await instance.parts({ categoryId: 100030, modificationId: 100000777, page: 1, typeId: 133 }, visitor)).status).toBe("ok");
    expect((await instance.parts({ categoryId: 424242, modificationId: 100000777, page: 1 }, visitor)).status).toBe("unknown_category");
  });
});
