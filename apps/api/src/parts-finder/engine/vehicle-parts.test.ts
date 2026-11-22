import { describe, expect, it, vi } from "vitest";

import { FAPI_URL, fapiRequest, partRef, type FapiGateway } from "./fapi.js";
import { UpstreamStatusError, type RequestJson } from "./http.js";
import { articleCandidate, buildVehicleVocabulary, normalizeQuery, oneTypo, phoneticKey, phoneticLatin } from "./part-query.js";
import {
  CATEGORIES, matchingNodes, searchVehicleParts, type FitmentLookup, type FitmentVariant, type SearchDependencies,
} from "./vehicle-parts.js";
import { groupVariants, parseFitmentCsv } from "./fitment.js";

const noFitment: FitmentLookup = { variants: async () => new Map() };

/** A gateway that must never be reached: every case here is free. */
function forbiddenFapi() {
  const fetch = vi.fn(async () => { throw new Error("FAPI must not be called"); });
  return { fapi: { fetch } as FapiGateway, fetch };
}

function deps(overrides: Partial<SearchDependencies> = {}): SearchDependencies {
  return { fapi: forbiddenFapi().fapi, fapiFitmentEnabled: true, fitment: noFitment, ...overrides };
}

describe("query reading (part_query.py)", () => {
  it("spells car names typed by ear in Cyrillic the Latin way", () => {
    expect(phoneticLatin("веста")).toEqual(["vesta"]);
    expect(phoneticLatin("Камри")).toEqual(["kamri", "camri"]);
    expect(oneTypo(phoneticLatin("камри")[1]!, "camry")).toBe(true);
    expect(oneTypo(phoneticLatin("солярис")[0]!, "solaris")).toBe(true);
  });

  it("fixes layout, transliteration and look-alikes and infers the make from the model", () => {
    expect(normalizeQuery("vfckzysq abkmnh ghj,jrc", CATEGORIES).tokens).toEqual(["toyota", "масляный", "фильтр", "probox"]);
    expect(normalizeQuery("щшд ашдеук ещнщеф зкщищч", CATEGORIES).tokens).toEqual(["oil", "filter", "toyota", "probox"]);
    expect(normalizeQuery("фильтр маслянных пробокс", CATEGORIES).tokens).toEqual(["toyota", "фильтр", "маслянных", "probox"]);
    expect(normalizeQuery("масляный фильтр сфькн 2019 2,5", CATEGORIES).corrected).toContain("camry");
  });

  it("accepts one typo only in known words", () => {
    expect(oneTypo("corola", "corolla")).toBe(true);
    expect(oneTypo("camyr", "camry")).toBe(true);
    expect(oneTypo("camera", "camry")).toBe(false);
  });

  it("tells part numbers from VINs, chassis and engine codes", () => {
    expect(articleCandidate(" W 75/3 ")).toBe("W 75/3");
    expect(articleCandidate("04152-40060")).toBe("04152-40060");
    expect(articleCandidate("XTAGFK330JY144213")).toBeNull();
    expect(articleCandidate("MXPH14-0036630")).toBeNull();
    expect(articleCandidate("1nr-fe")).toBeNull();
    expect(articleCandidate("масляный фильтр")).toBeNull();
  });
});

describe("guided search without paid calls (vehicle_parts.py)", () => {
  it("reads Probox by phrase and by chassis without FAPI", async () => {
    const { fapi, fetch } = forbiddenFapi();
    const all = await searchVehicleParts({ query: "фильтр маслянных пробокс" }, deps({ fapi }), false);
    expect([all.status, all.vehicle]).toEqual(["reference", "Toyota Probox"]);
    expect(new Set((all.parts as Array<{ article: string }>).map((part) => part.article)))
      .toEqual(new Set(["04152-40060", "90915-10003", "90915-10009", "90915-20003"]));
    const specific = await searchVehicleParts({ query: "масляный фильтр Пробокс NSP160" }, deps({ fapi }), false);
    expect((specific.parts as Array<{ article: string }>).map((part) => part.article)).toEqual(["04152-40060"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("gives the same engine choice for every spelling, then the date split for NCP160V", async () => {
    const spellings = [
      "фильтр маслянных пробокс", "vfckzysq abkmnh ghj,jrc", "maslyaniy filtr Proboks",
      "щшд ашдеук ещнщеф зкщищч", "филтр масляный Toyota ghj,jrc", "масляный фильтр пробокс",
    ];
    const answers = await Promise.all(spellings.map((query) => searchVehicleParts({ query }, deps())));
    for (const answer of answers) {
      expect([answer.vehicle, answer.field]).toEqual(["Toyota Probox", "engine"]);
      expect((answer.options as unknown[]).length).toBeGreaterThan(1);
      expect(answer.options).toEqual(answers[0]!.options);
    }
    const query = "масляный фильтр Пробокс NCP160V";
    const engine = await searchVehicleParts({ query }, deps());
    const engineId = (engine.options as Array<{ id: number }>)[0]!.id;
    const versions = await searchVehicleParts({ query, choices: { engine: engineId } }, deps());
    expect(versions.field).toBe("version");
    const options = versions.options as Array<{ id: number; label: string }>;
    expect(options.map((option) => option.label)).toEqual(["NCP160V / NCP165V · 09.2014–02.2023", "NCP160V / NCP165V · с 03.2023"]);
    const modern = await searchVehicleParts({ query, choices: { engine: engineId, version: options[1]!.id } }, deps());
    expect((modern.parts as Array<{ article: string }>).map((part) => part.article)).toEqual(["90915-10009"]);
    const old = await searchVehicleParts({ query, choices: { engine: engineId, version: options[0]!.id } }, deps());
    expect((old.parts as Array<{ article: string }>).map((part) => part.article)).toEqual(["90915-10003"]);
    const dated = await searchVehicleParts({ query: `${query} 02.2023`, choices: { engine: engineId } }, deps());
    expect((dated.parts as Array<{ article: string }>).map((part) => part.article)).toEqual(["90915-10003"]);
  });

  it("NSP160V with 1NR-FE leads to 04152-40060", async () => {
    const query = "масляный фильтр пробокс NSP160V 1NR-FE";
    const step = await searchVehicleParts({ query }, deps());
    expect(step.options).toEqual([{ id: 1, label: "1.3 л · бензин · 1NR-FE · NSP160V" }]);
    const result = await searchVehicleParts({ query, choices: { engine: 1 } }, deps());
    expect(result).toMatchObject({ status: "reference", engine: "1.3 л · бензин · 1NR-FE · NSP160V" });
    expect((result.parts as Array<{ article: string; source: string }>)[0]).toMatchObject({ article: "04152-40060", source: "DENSO" });
  });

  it("asks for the car, confirms before a paid lookup and offers both article spellings", async () => {
    expect((await searchVehicleParts({ query: "колодки" }, deps())).status).toBe("need_vehicle");
    expect(await searchVehicleParts({ query: "масляный фильтр сфькн 2019 2,5" }, deps())).toMatchObject({
      status: "confirm", vehicle: "Toyota Camry · 2019 · 2,5 л",
    });
    const article = await searchVehicleParts({ query: "ДКс 0127" }, deps());
    expect((article.options as Array<{ label: string }>).map((option) => option.label)).toEqual(["ДКс 0127", "LRC 0127"]);
    expect(await searchVehicleParts({ query: "04152-40060" }, deps())).toEqual({ status: "article", article: "04152-40060" });
    expect((await searchVehicleParts({ query: "фильтр" }, deps())).status).toBe("need_detail");
  });

  it("stops before FAPI when vehicle fitment through FAPI is off", async () => {
    expect(await searchVehicleParts({ query: "масляный фильтр Camry 2002", confirmed: true }, deps({ fapiFitmentEnabled: false })))
      .toMatchObject({ status: "no_data", category: "Масляный фильтр", vehicle: "Toyota Camry" });
  });

  it("rejects bad choices and queries", async () => {
    await expect(searchVehicleParts({ query: "" }, deps())).rejects.toMatchObject({ code: "invalid_parts_query" });
    await expect(searchVehicleParts({ query: "фильтр", choices: { colour: 1 } }, deps())).rejects.toMatchObject({ code: "invalid_catalog_choice" });
    await expect(searchVehicleParts({ query: "масляный фильтр пробокс", choices: { engine: 999 } }, deps()))
      .rejects.toMatchObject({ code: "invalid_catalog_choice", status: 400 });
  });
});

describe("shop fitment (local_fitment.py)", () => {
  const csv = "make,model,category,configuration,engine,liters,year_from,year_to,article,brand,oem,source\n"
    + "Toyota,Camry,Масляный фильтр,XV70 2.5,A25A-FKS,2.5,2018,2024,EXAMPLE-1,Example,1,Тест\n"
    + "Toyota,Camry,Масляный фильтр,XV50 2.0,6AR-FSE,2.0,2014,2017,EXAMPLE-2,Example,0,Тест\n";

  it("validates CSV, keeps leading zeros and guides by the shop's rows without FAPI", async () => {
    const rows = parseFitmentCsv(`\uFEFF${csv}Lada,Vesta,Масляный фильтр,1.6,21129,1.6,2015,,0015 4500,LADA,1,Тест\n`, new Set(["Масляный фильтр"]));
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ article: "0015 4500", makeKey: "lada", modelKey: "vesta", yearTo: null, oem: true });
    const fitment: FitmentLookup = {
      variants: async (tokens, category, year, engine, liters) => groupVariants(
        rows.filter((row) => row.category === category && tokens.includes(row.makeKey) && tokens.includes(row.modelKey)), year, engine, liters,
      ),
    };
    const { fapi, fetch } = forbiddenFapi();
    const options = { fapi, fapiFitmentEnabled: false, fitment };
    const step = await searchVehicleParts({ query: "масляный фильтр Камри 2019 2,5" }, options);
    expect(step.field).toBe("local_variant");
    const variants = step.options as FitmentVariant[];
    expect(variants).toHaveLength(1);
    expect(variants[0]!.label).toBe("XV70 2.5 · 2.5 л · A25A-FKS · 2018–2024");
    const result = await searchVehicleParts({ query: "масляный фильтр Камри 2019 2,5", choices: { local_variant: variants[0]!.id } }, options);
    expect(result).toMatchObject({ status: "reference", message: "По каталогу магазина.", vehicle: "Toyota Camry" });
    expect((result.parts as Array<{ article: string; oem: boolean }>)[0]).toEqual({
      article: "EXAMPLE-1", brand: "Example", description: "XV70 2.5", oem: true, source: "Тест",
    });
    expect((await searchVehicleParts({ query: "масляный фильтр Camry 2002", confirmed: true }, options)).status).toBe("no_data");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("names the failing line", () => {
    expect(() => parseFitmentCsv(`${csv}Toyota,Camry,Неизвестно,X,,,,,A1,B,1,S\n`, new Set(["Масляный фильтр"])))
      .toThrow("строке 4");
    expect(() => parseFitmentCsv("make,model\nA,B\n", new Set(["Масляный фильтр"]))).toThrow("Нужны столбцы");
    expect(() => parseFitmentCsv(csv.split("\n")[0]!, new Set(["Масляный фильтр"]))).toThrow("нет данных");
    expect(() => parseFitmentCsv(`${csv}Toyota,Camry,Масляный фильтр,X,,,2020,2010,A1,B,1,S\n`, new Set(["Масляный фильтр"]))).toThrow("строке 4");
  });
});

describe("FAPI catalogue walk", () => {
  it("selects one node, ignores housings and shares the parts list", async () => {
    const answers: Record<string, unknown> = {
      "/catalogList/dt/manufacturerList": { mf: [{ dbi: 111, ds: "TOYOTA" }] },
      "/catalogList/dt/modelList": { m: [{ dbi: 123, d: "CAMRY (XV70)" }] },
      "/catalogList/dt/modificationList": { m: [{ dbi: 456, d: "2.5", fd: "Toyota Camry 2.5", engineCode: "A25A-FKS" }] },
      "/catalogList/dt/treeList": [{ i: 789, d: "Масляный фильтр" }, { i: 790, d: "Корпус масляного фильтра" }],
      "/catalogList/dt/productList": [{ mfi: 12, mfd: "MANN", n: "W 75/3", d: "Фильтр масляный" }],
    };
    const fetch = vi.fn(async (endpoint: string) => answers[endpoint]);
    const search = { query: "масляный фильтр Тойота Камри", confirmed: true };
    const options = await searchVehicleParts(search, deps({ fapi: { fetch } }));
    expect([options.field, fetch.mock.calls.length]).toEqual(["modification", 3]);
    const found = await searchVehicleParts({ ...search, choices: { ...(options.choices as object), modification: 456 } }, deps({ fapi: { fetch } }));
    expect(found.status).toBe("found");
    expect((found.parts as Array<{ article: string }>)[0]!.article).toBe("W 75/3");
    expect(fetch).toHaveBeenLastCalledWith("/catalogList/dt/productList", { modi: 456, nodei: 789 }, 8);
  });

  it("drops motorcycle groups from a car's tree", () => {
    const nodes = matchingNodes([
      { i: 1, d: "Фильтр" }, { i: 2, d: "Мотоцикл" }, { i: 3, d: "Фильтр", pi: 2 },
      { i: 4, d: "Топливный фильтр", pi: 1 }, { i: 5, d: "Топливный фильтр", pi: 3 },
    ], CATEGORIES[3]![1]);
    expect(nodes.map((node) => node.label)).toEqual(["Фильтр → Топливный фильтр"]);
  });

  it("labels identical group names by their parent section", () => {
    const nodes = matchingNodes([
      { i: 1, d: "Двигатель" }, { i: 2, d: "Фильтрация" },
      { i: 3, d: "Масляный фильтр", pi: 1 }, { i: 4, d: "Масляный фильтр", pi: 2 },
    ], CATEGORIES[0]![1]);
    expect(nodes.map((node) => node.label)).toEqual(["Двигатель → Масляный фильтр", "Фильтрация → Масляный фильтр"]);
  });

  it("maps FAPI refusals and parses part references", async () => {
    const http: RequestJson = async () => { throw new UpstreamStatusError(401, {}); };
    await expect(fapiRequest("/part", "k", http)).rejects.toMatchObject({ code: "fapi_key_expired", status: 401 });
    await expect(fapiRequest("/part", undefined, http)).rejects.toMatchObject({ code: "fapi_key_missing" });
    expect(partRef({ mfi: 9, ds: "Other Brand", ns: "AB100", rp: 3, rm: 0, mfc: true })).toEqual({
      article: "AB100", brand: "Other Brand", manufacturer_id: 9, manufacturer_verified: true, votes_for: 3, votes_against: 0,
    });
    expect(partRef({ mfi: true, ds: "X", n: "1" })).toBeNull();
    expect(FAPI_URL).toBe("https://fapi.iisis.ru/fapi/v2");
  });
});

describe("car names read through the vehicle catalog", () => {
  const vocabulary = buildVehicleVocabulary({
    exclude: ["Sakura", "MANN-FILTER"],
    makes: [{ name: "Toyota", nameRu: "Тойота" }, { name: "Nissan", nameRu: "Ниссан" }, { name: "Daihatsu", nameRu: "Дайхатсу" }, { name: "Renault", nameRu: "Рено" }, { name: "Chevrolet", nameRu: "Шевроле" }],
    models: [
      { make: "Toyota", name: "Gaia (_M1_)" }, { make: "Toyota", name: "Noah/Voxy (_R6_)" }, { make: "Toyota", name: "Corolla Седан (_E12_)" },
      { make: "Toyota", name: "Caldina Универсал (_T21_)" }, { make: "Toyota", name: "Kluger (_U2_)" }, { make: "Toyota", name: "Vitz (_P1_)" },
      { make: "Toyota", name: "Sprinter" }, { make: "Nissan", name: "Cefiro II Седан (A32)" }, { make: "Nissan", name: "Patrol (Y61)" },
      { make: "Nissan", name: "Sakura" }, { make: "Nissan", name: "Juke (F15)" }, { make: "Daihatsu", name: "Terios (J1_)" },
      { make: "Renault", name: "Megane II" }, { make: "Chevrolet", name: "Bolt" }, { make: "Chevrolet", name: "Sprinter" },
    ],
  });
  const tokens = (query: string) => normalizeQuery(query, CATEGORIES, vocabulary).tokens;

  it("gives one key to a name typed in either alphabet", () => {
    for (const [russian, latin] of [["гайя", "gaia"], ["вокси", "voxy"], ["королла", "corolla"], ["цефиро", "cefiro"], ["клюгер", "kluger"], ["витц", "vitz"], ["сивик", "civic"], ["аккорд", "accord"], ["паджеро", "pajero"], ["премаси", "premacy"], ["одиссей", "odyssey"], ["кашкай", "qashqai"]]) {
      expect(phoneticKey(russian!), russian).toBe(phoneticKey(latin!));
    }
  });

  it("reads a Japanese model typed in Russian and adds its make", () => {
    expect(tokens("топливный фильтр гайя")).toEqual(["toyota", "топливный", "фильтр", "gaia"]);
    expect(tokens("колодки на короллу 2003")).toEqual(["toyota", "колодки", "на", "corolla", "2003"]);
    expect(tokens("масляный фильтр вокси")).toEqual(["toyota", "масляный", "фильтр", "voxy"]);
    expect(tokens("колодки цефиро")).toEqual(["nissan", "колодки", "cefiro"]);
    expect(tokens("фильтр дайхатсу териос")).toEqual(["фильтр", "daihatsu", "terios"]);
    expect(tokens("свечи меган")).toEqual(["renault", "свечи", "megane"]);
    expect(tokens("колодки жук")).toEqual(["nissan", "колодки", "juke"]);
  });

  it("never turns a part word, a fastener or a parts brand into a car", () => {
    expect(tokens("гайка колесная")).toEqual(["гайка", "колесная"]);
    expect(tokens("патрон лампы")).toEqual(["патрон", "лампы"]);
    expect(tokens("болт колесный")).toEqual(["болт", "колесный"]);
    expect(tokens("фильтр сакура")).toEqual(["фильтр", "сакура"]);
    expect(tokens("гайки")).toEqual(["гайки"]);
  });

  it("does not guess a make for a model name two makes share", () => {
    expect(tokens("колодки спринтер")).toEqual(["колодки", "sprinter"]);
  });
});
