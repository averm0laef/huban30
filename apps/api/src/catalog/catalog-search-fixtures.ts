// A small, realistic auto-parts catalog for the real-database search
// regression suite (catalog-search-regression.test.ts) and for seeding a
// scratch database by hand. Names, articles and brands follow how 1C
// exports them: Russian names with ё, articles with spaces/slashes, one
// article typed in 1C with a Cyrillic "С", brands in Latin and Cyrillic.
//
// Every row is tagged with external_id 'search-fixture:<key>' so the
// fixture can be removed again without touching anything else.

import { productSearchText } from "./catalog-search-reading.js";

export interface FixtureProduct {
  key: string;
  sku: string;
  name: string;
  brand: string | null;
  category: string;
  rubles: number | null;
  stock: number;
  hidden?: "inactive" | "deleted";
}

const PREFIX = "search-fixture:";

export const FIXTURE_CATEGORIES = [
  { slug: "sf-motornye-masla", name: "Моторные масла" },
  { slug: "sf-filtry", name: "Фильтры" },
  { slug: "sf-tormoznaya-sistema", name: "Тормозная система" },
  { slug: "sf-avtolampy", name: "Автолампы" },
  { slug: "sf-shchetki", name: "Щётки стеклоочистителя" },
  { slug: "sf-akkumulyatory", name: "Аккумуляторы" },
  { slug: "sf-avtohimiya", name: "Автохимия" },
  { slug: "sf-svechi", name: "Свечи зажигания" },
  { slug: "sf-podveska", name: "Подвеска и охлаждение" },
  { slug: "sf-arhiv", name: "Архив", inactive: true },
] as const;

export const FIXTURE_BRANDS = [
  "MANN-FILTER", "Bosch", "TRW", "NGK", "Лукойл", "Castrol", "Mobil", "Shell", "Febi Bilstein",
  "Lemförder", "Philips", "Osram", "Liqui Moly", "Felix", "Varta", "Brembo", "MAHLE", "Denso",
  "Sintec", "Valeo", "Champion", "KYB", "ContiTech", "Unigom", "Снятый бренд",
] as const;
const INACTIVE_BRANDS = new Set(["Снятый бренд"]);

// Hand-written core rows referenced by the regression cases (by key).
export const CORE_PRODUCTS: FixtureProduct[] = [
  // Filters
  { key: "mann-w914-2", sku: "W 914/2", name: "Фильтр масляный MANN-FILTER W 914/2", brand: "MANN-FILTER", category: "sf-filtry", rubles: 450, stock: 12 },
  // The owner's base puts the shop's own code in brackets before the name, in Cyrillic or in Latin look-alikes.
  { key: "kc171-cyrillic", sku: "8200414SX", name: "(КС171) Фильтр топливный d108 h168 IVECO Cursor 82-00414-SX", brand: null, category: "sf-filtry", rubles: 1450, stock: 2 },
  { key: "kc117-latin", sku: "PP861/3", name: "(KC117) Фильтр топливный MAN Scania Iveco Fiat Ducato 8220434SX", brand: null, category: "sf-filtry", rubles: 950, stock: 2 },
  { key: "velo-tyre", sku: "00-00051234", name: "Велопокрышка 47-203 Л-356 без кам.", brand: null, category: "sf-podveska", rubles: 600, stock: 3 },
  { key: "velo-tube", sku: "00-00051235", name: "Камера велосипедная AV 35 37/54-559", brand: null, category: "sf-podveska", rubles: 250, stock: 5 },
  { key: "mann-w712-75", sku: "W 712/75", name: "Фильтр масляный W 712/75", brand: "MANN-FILTER", category: "sf-filtry", rubles: 520, stock: 0 },
  { key: "mann-w712-95", sku: "W 712/95", name: "Фильтр масляный W 712/95", brand: "MANN-FILTER", category: "sf-filtry", rubles: 540, stock: 3 },
  { key: "mann-hu7008z", sku: "HU 7008 z", name: "Фильтр масляный (картридж) HU 7008 z", brand: "MANN-FILTER", category: "sf-filtry", rubles: 890, stock: 4 },
  // Article typed in 1C with a Cyrillic "С".
  { key: "mann-c30005", sku: "С 30 005", name: "Фильтр воздушный C 30 005", brand: "MANN-FILTER", category: "sf-filtry", rubles: 990, stock: 2 },
  { key: "mann-cu2939", sku: "CU 2939", name: "Фильтр салонный CU 2939", brand: "MANN-FILTER", category: "sf-filtry", rubles: 760, stock: 6 },
  { key: "mann-cuk2939", sku: "CUK 2939", name: "Фильтр салонный угольный CUK 2939", brand: "MANN-FILTER", category: "sf-filtry", rubles: 1100, stock: 0 },
  { key: "mann-wk820-1", sku: "WK 820/1", name: "Фильтр топливный WK 820/1", brand: "MANN-FILTER", category: "sf-filtry", rubles: 1350, stock: 1 },
  { key: "bosch-0986452041", sku: "0 986 452 041", name: "Фильтр масляный", brand: "Bosch", category: "sf-filtry", rubles: 480, stock: 5 },
  { key: "mahle-oc90", sku: "OC 90", name: "Фильтр масляный OC 90", brand: "MAHLE", category: "sf-filtry", rubles: 600, stock: 7 },
  { key: "mahle-kx70d", sku: "KX 70D", name: "Фильтр топливный KX 70D", brand: "MAHLE", category: "sf-filtry", rubles: 1250, stock: 0 },
  { key: "febi-27155", sku: "27155", name: "Фильтр масляный", brand: "Febi Bilstein", category: "sf-filtry", rubles: 390, stock: 9 },
  { key: "unigom-w9142", sku: "W9142", name: "Патрубок системы охлаждения", brand: "Unigom", category: "sf-podveska", rubles: 700, stock: 0 },
  // Never public: inactive, deleted, hidden category, inactive brand.
  { key: "hidden-inactive", sku: "W 914/3", name: "Фильтр масляный W 914/3 (снят с продажи)", brand: "MANN-FILTER", category: "sf-filtry", rubles: 450, stock: 5, hidden: "inactive" },
  { key: "hidden-deleted", sku: "W 914/4", name: "Фильтр масляный W 914/4 (удалён)", brand: "MANN-FILTER", category: "sf-filtry", rubles: 450, stock: 5, hidden: "deleted" },
  { key: "hidden-category", sku: "W 920/21", name: "Фильтр масляный W 920/21 архивный", brand: "MANN-FILTER", category: "sf-arhiv", rubles: 450, stock: 5 },
  { key: "hidden-brand", sku: "SB-100", name: "Фильтр масляный снятого бренда", brand: "Снятый бренд", category: "sf-filtry", rubles: 300, stock: 5 },
  // Brakes
  { key: "bosch-0986494104", sku: "0 986 494 104", name: "Колодки тормозные дисковые передние", brand: "Bosch", category: "sf-tormoznaya-sistema", rubles: 2350, stock: 8 },
  { key: "bosch-0986494105", sku: "0 986 494 105", name: "Колодки тормозные дисковые задние", brand: "Bosch", category: "sf-tormoznaya-sistema", rubles: 2100, stock: 0 },
  { key: "bosch-0986478868", sku: "0 986 478 868", name: "Диск тормозной передний вентилируемый", brand: "Bosch", category: "sf-tormoznaya-sistema", rubles: 3900, stock: 2 },
  { key: "trw-gdb1330", sku: "GDB1330", name: "Колодки тормозные передние TRW GDB1330", brand: "TRW", category: "sf-tormoznaya-sistema", rubles: 2600, stock: 3 },
  { key: "trw-gdb1550", sku: "GDB1550", name: "Колодки тормозные дисковые", brand: "TRW", category: "sf-tormoznaya-sistema", rubles: 2900, stock: 0 },
  { key: "trw-df4294", sku: "DF4294", name: "Диск тормозной передний", brand: "TRW", category: "sf-tormoznaya-sistema", rubles: 3500, stock: 2 },
  { key: "trw-df4294s", sku: "DF4294S", name: "Диск тормозной передний (комплект)", brand: "TRW", category: "sf-tormoznaya-sistema", rubles: 6900, stock: 1 },
  // 5 780 names of the owner's base start with the article; the storefront shows them without it.
  { key: "brembo-09a42511", sku: "09.A425.11", name: "09.A425.11 Диск тормозной задний Brembo", brand: "Brembo", category: "sf-tormoznaya-sistema", rubles: 4200, stock: 1 },
  { key: "trw-pfb401", sku: "PFB401", name: "Жидкость тормозная DOT 4 0,5 л", brand: "TRW", category: "sf-tormoznaya-sistema", rubles: 450, stock: 20 },
  { key: "brembo-09a72711", sku: "09.A727.11", name: "Диск тормозной передний вентилируемый", brand: "Brembo", category: "sf-tormoznaya-sistema", rubles: 4700, stock: 0 },
  { key: "brembo-p85020", sku: "P 85 020", name: "Колодка тормозная дисковая", brand: "Brembo", category: "sf-tormoznaya-sistema", rubles: 3100, stock: 4 },
  { key: "febi-16969", sku: "16969", name: "Колодки тормозные барабанные, комплект колодок", brand: "Febi Bilstein", category: "sf-tormoznaya-sistema", rubles: 1900, stock: 2 },
  // Spark plugs
  { key: "ngk-bkr6e", sku: "BKR6E", name: "Свеча зажигания BKR6E", brand: "NGK", category: "sf-svechi", rubles: 290, stock: 40 },
  { key: "ngk-bkr6e-11", sku: "BKR6E-11", name: "Свеча зажигания BKR6E-11", brand: "NGK", category: "sf-svechi", rubles: 310, stock: 25 },
  { key: "ngk-zfr6f-11", sku: "ZFR6F-11", name: "Свеча зажигания ZFR6F-11", brand: "NGK", category: "sf-svechi", rubles: 330, stock: 0 },
  { key: "bosch-0242235668", sku: "0 242 235 668", name: "Свеча зажигания FR7DC+", brand: "Bosch", category: "sf-svechi", rubles: 350, stock: 16 },
  { key: "denso-ik20", sku: "IK20", name: "Свеча зажигания иридиевая IK20", brand: "Denso", category: "sf-svechi", rubles: 1150, stock: 6 },
  { key: "champion-rn9yc", sku: "RN9YC", name: "Свеча зажигания RN9YC", brand: "Champion", category: "sf-svechi", rubles: 240, stock: 0 },
  // Lamps
  { key: "philips-h7", sku: "12972PRC1", name: "Лампа H7 12V 55W Vision +30%", brand: "Philips", category: "sf-avtolampy", rubles: 450, stock: 30 },
  { key: "philips-h4", sku: "12342PRC1", name: "Лампа H4 12V 60/55W Vision", brand: "Philips", category: "sf-avtolampy", rubles: 420, stock: 12 },
  { key: "osram-h7", sku: "64210", name: "Лампа галогенная H7 12V 55W Original", brand: "Osram", category: "sf-avtolampy", rubles: 380, stock: 0 },
  { key: "osram-h4", sku: "64193", name: "Лампа галогенная H4 12V 60/55W", brand: "Osram", category: "sf-avtolampy", rubles: 360, stock: 14 },
  { key: "osram-w5w", sku: "2825", name: "Лампа W5W 12V 5W", brand: "Osram", category: "sf-avtolampy", rubles: 60, stock: 100 },
  // Wipers
  { key: "bosch-3397007297", sku: "3 397 007 297", name: "Щётка стеклоочистителя бескаркасная Aerotwin 600/450 мм, комплект", brand: "Bosch", category: "sf-shchetki", rubles: 2400, stock: 5 },
  { key: "bosch-3397018802", sku: "3 397 018 802", name: "Щётка стеклоочистителя каркасная 530 мм", brand: "Bosch", category: "sf-shchetki", rubles: 690, stock: 0 },
  { key: "valeo-vf423", sku: "VF423", name: "Щётки стеклоочистителя Silencio 650/400 мм", brand: "Valeo", category: "sf-shchetki", rubles: 1900, stock: 3 },
  { key: "champion-winter", sku: "WX50E01", name: "Щётка стеклоочистителя зимняя 500 мм", brand: "Champion", category: "sf-shchetki", rubles: 950, stock: 7 },
  // Batteries
  { key: "bosch-s4005", sku: "0 092 S40 050", name: "Аккумулятор Bosch S4 005 60Ач 540А обратная полярность", brand: "Bosch", category: "sf-akkumulyatory", rubles: 9800, stock: 2 },
  { key: "varta-d24", sku: "560408054", name: "Аккумулятор Varta Blue Dynamic D24 60Ач 540А", brand: "Varta", category: "sf-akkumulyatory", rubles: 10500, stock: 0 },
  { key: "varta-e11", sku: "574012068", name: "Аккумулятор Varta Blue Dynamic E11 74Ач 680А", brand: "Varta", category: "sf-akkumulyatory", rubles: 12900, stock: 3 },
  // Oils
  { key: "lukoil-lux-5w40-4", sku: "207465", name: "Масло моторное ЛУКОЙЛ ЛЮКС 5W-40 полусинтетическое 4 л", brand: "Лукойл", category: "sf-motornye-masla", rubles: 1650, stock: 15 },
  { key: "lukoil-lux-5w40-1", sku: "207464", name: "Масло моторное ЛУКОЙЛ ЛЮКС 5W-40 полусинтетическое 1 л", brand: "Лукойл", category: "sf-motornye-masla", rubles: 480, stock: 30 },
  { key: "lukoil-genesis-5w30-4", sku: "3148675", name: "Масло моторное Лукойл Генезис Армортек 5W-30 синтетическое 4л", brand: "Лукойл", category: "sf-motornye-masla", rubles: 2900, stock: 8 },
  { key: "lukoil-standard-10w40-5", sku: "19435", name: "Масло моторное Лукойл Стандарт 10W-40 минеральное 5 л", brand: "Лукойл", category: "sf-motornye-masla", rubles: 1500, stock: 4 },
  { key: "castrol-edge-5w30-4", sku: "15669A", name: "Масло моторное Castrol EDGE 5W-30 LL 4 л", brand: "Castrol", category: "sf-motornye-masla", rubles: 4200, stock: 6 },
  { key: "castrol-magnatec-5w40-4", sku: "156E9E", name: "Масло моторное Castrol Magnatec 5W-40 A3/B4 4 л", brand: "Castrol", category: "sf-motornye-masla", rubles: 3300, stock: 0 },
  { key: "castrol-syntrans-75w90", sku: "15D704", name: "Масло трансмиссионное Castrol Syntrans 75W-90 1 л", brand: "Castrol", category: "sf-motornye-masla", rubles: 1400, stock: 3 },
  { key: "mobil-3000-5w40-4", sku: "152566", name: "Масло моторное Mobil Super 3000 X1 5W-40 4 л", brand: "Mobil", category: "sf-motornye-masla", rubles: 3100, stock: 0 },
  { key: "mobil-1-0w40-4", sku: "153678", name: "Масло моторное Mobil 1 FS 0W-40 4 л", brand: "Mobil", category: "sf-motornye-masla", rubles: 4800, stock: 5 },
  { key: "shell-hx8-5w40-4", sku: "550046355", name: "Масло моторное Shell Helix HX8 5W-40 синтетическое 4л", brand: "Shell", category: "sf-motornye-masla", rubles: 3000, stock: 9 },
  { key: "shell-ultra-5w30-4", sku: "550040295", name: "Масло моторное Shell Helix Ultra 5W-30 4 л", brand: "Shell", category: "sf-motornye-masla", rubles: 3600, stock: 2 },
  { key: "liqui-toptec-5w30-1", sku: "8028", name: "Масло моторное Top Tec 4200 5W-30 1 л", brand: "Liqui Moly", category: "sf-motornye-masla", rubles: 1500, stock: 4 },
  { key: "sintec-platinum-5w40-4", sku: "801941", name: "Масло моторное Sintec Platinum SAE 5W40 4л", brand: "Sintec", category: "sf-motornye-masla", rubles: 1700, stock: 11 },
  // Chemicals
  { key: "felix-g12-5", sku: "430206012", name: "Антифриз Felix Carbox G12+ красный 5 кг", brand: "Felix", category: "sf-avtohimiya", rubles: 1300, stock: 7 },
  { key: "liqui-injection-cleaner", sku: "1971", name: "Очиститель инжектора Injection Reiniger 300 мл", brand: "Liqui Moly", category: "sf-avtohimiya", rubles: 1100, stock: 5 },
  { key: "liqui-brake-cleaner", sku: "3318", name: "Очиститель тормозов Bremsen-Reiniger 500 мл", brand: "Liqui Moly", category: "sf-avtohimiya", rubles: 900, stock: 0 },
  { key: "sintec-washer-4", sku: "900550", name: "Жидкость стеклоомывателя зимняя -20 °C 4 л", brand: "Sintec", category: "sf-avtohimiya", rubles: 350, stock: 40 },
  { key: "liqui-sealant", sku: "3829", name: "Герметик прокладок чёрный 80 мл", brand: "Liqui Moly", category: "sf-avtohimiya", rubles: 950, stock: 3 },
  { key: "felix-litol", sku: "411040026", name: "Смазка литиевая Литол-24 400 г", brand: "Felix", category: "sf-avtohimiya", rubles: 280, stock: 12 },
  // Suspension, belts
  { key: "lemforder-3456701", sku: "34567 01", name: "Рычаг подвески передний нижний левый", brand: "Lemförder", category: "sf-podveska", rubles: 5200, stock: 1 },
  { key: "lemforder-3063401", sku: "30634 01", name: "Тяга стабилизатора передняя", brand: "Lemförder", category: "sf-podveska", rubles: 1700, stock: 0 },
  { key: "febi-17402", sku: "17402", name: "Шаровая опора", brand: "Febi Bilstein", category: "sf-podveska", rubles: 1400, stock: 6 },
  { key: "kyb-334834", sku: "334834", name: "Амортизатор газомасляный передний", brand: "KYB", category: "sf-podveska", rubles: 5600, stock: 2 },
  { key: "contitech-ct1028", sku: "CT1028", name: "Ремень ГРМ", brand: "ContiTech", category: "sf-podveska", rubles: 2100, stock: 3 },
  // Names as the owner's 1С types them: shorthand, and a Latin letter that looks like the Russian one (the «T» of
  // «Tяга» below is Latin). Each has a plainly named neighbour, so the search has an answer without them — and
  // must still find them by the proper word.
  { key: "fuse-plain", sku: "MFS-40", name: "Предохранитель силовой 40А", brand: null, category: "sf-podveska", rubles: 120, stock: 5 },
  { key: "fuse-shorthand", sku: "MFS-075", name: "Предохр. флажковые 7.5А", brand: null, category: "sf-podveska", rubles: 90, stock: 9 },
  { key: "scent-plain", sku: "AR-1", name: "Ароматизатор подвесной AREON", brand: null, category: "sf-avtohimiya", rubles: 150, stock: 6 },
  { key: "scent-shorthand", sku: "AU-171", name: "Аром-р AURA FRESH Black Ice", brand: null, category: "sf-avtohimiya", rubles: 170, stock: 4 },
  { key: "leads-plain", sku: "2123-3707080-10", name: "Провода высоковольтные ВАЗ 2123", brand: null, category: "sf-svechi", rubles: 900, stock: 2 },
  { key: "leads-shorthand", sku: "2123-3707080-20", name: "Провода в/в 2123 силикон", brand: null, category: "sf-svechi", rubles: 1100, stock: 3 },
  { key: "rod-latin-t", sku: "VL-325", name: "Tяга реактивная FH12 L=325", brand: null, category: "sf-podveska", rubles: 4300, stock: 1 },
  // Parts customers ask for by an everyday word that is not in the name (catalog-search-tokens.ts, WORD_SYNONYMS).
  { key: "cv-joint", sku: "CO-3601", name: "ШРУС наружный", brand: null, category: "sf-podveska", rubles: 3200, stock: 2 },
  { key: "cv-boot", sku: "MF-2121", name: "Пыльник ШРУСа наружный", brand: null, category: "sf-podveska", rubles: 600, stock: 7 },
  { key: "link-front", sku: "CLT-17", name: "Стойка стабилизатора передняя", brand: null, category: "sf-podveska", rubles: 950, stock: 4 },
  { key: "bush-t", sku: "TAB-054", name: "Сайлентблок задней балки", brand: null, category: "sf-podveska", rubles: 700, stock: 3 },
  { key: "bush-no-t", sku: "SA-090", name: "Сайленблок рессоры", brand: null, category: "sf-podveska", rubles: 450, stock: 2 },
  { key: "wd40", sku: "WD-0002", name: "Смазка универсальная WD-40 200 мл", brand: null, category: "sf-avtohimiya", rubles: 520, stock: 14 },
  { key: "lock-nuts", sku: "SK-1215", name: "Гайки секретные М12х1,5", brand: null, category: "sf-podveska", rubles: 1300, stock: 2 },
  { key: "wheel-wrench-one-l", sku: "34019", name: "Ключ балонный 19 мм", brand: null, category: "sf-podveska", rubles: 380, stock: 5 },
  { key: "wheel-wrench-two-l", sku: "KB-4", name: "Ключ баллонный крестовой", brand: null, category: "sf-podveska", rubles: 890, stock: 3 },
  // A name with the staff's own notes typed into it in 1С, as a product accepted before the exchange began to
  // take them out: the storefront shows it without them (packages/contracts/src/product-name.ts).
  { key: "clip-noted", sku: "KP-170", name: "(Ш) +++ Клипса крепежная TORSO КОРОБКА 9", brand: null, category: "sf-podveska", rubles: 30, stock: 50 },
  // Goods that share an adjective with a filter: «воздушник» is the air filter and nothing else.
  { key: "air-coupler", sku: "AH-10", name: "Быстросъём воздушный", brand: null, category: "sf-podveska", rubles: 250, stock: 6 },
  { key: "fuel-sensor", sku: "DB067", name: "Датчик топливного фильтра", brand: null, category: "sf-podveska", rubles: 900, stock: 30 },
  { key: "cabin-fan", sku: "KS-4", name: "Вентилятор салонный", brand: null, category: "sf-avtohimiya", rubles: 2400, stock: 5 },
];

function generatedProducts(): FixtureProduct[] {
  const rows: FixtureProduct[] = [];
  const add = (row: Omit<FixtureProduct, "key" | "stock">, index: number) => {
    rows.push({ ...row, key: `gen-${rows.length}`, stock: index % 3 === 0 ? 0 : (index % 7) + 1 });
  };
  const oilLines: Array<[string, string, string]> = [
    ["Лукойл", "ЛУКОЙЛ Авангард", "минеральное"], ["Castrol", "Castrol GTX", "полусинтетическое"],
    ["Mobil", "Mobil Super 2000", "полусинтетическое"], ["Shell", "Shell Helix HX7", "полусинтетическое"],
    ["Liqui Moly", "Liqui Moly Molygen", "синтетическое"], ["Sintec", "Sintec Premium", "синтетическое"],
  ];
  const viscosities = ["0W-20", "5W-30", "10W-40", "15W-40"];
  const volumes = ["1 л", "4 л", "5 л"];
  let index = 0;
  for (const [brand, line, base] of oilLines) for (const viscosity of viscosities) for (const volume of volumes) {
    add({ sku: `OIL-${7000 + index}`, name: `Масло моторное ${line} ${viscosity} ${base} ${volume}`, brand, category: "sf-motornye-masla", rubles: 500 + (index % 9) * 350 }, index);
    index += 1;
  }
  const mannFilters = ["W 610/3", "W 67/1", "W 811/80", "W 75/3", "HU 816 x", "HU 719/7 x", "C 2433/2", "C 25 114", "CU 1919", "CU 2545", "WK 842/2", "WK 939"];
  for (const sku of mannFilters) {
    const kind = sku.startsWith("W ") || sku.startsWith("HU") ? "масляный" : sku.startsWith("C ") ? "воздушный" : sku.startsWith("CU") ? "салонный" : "топливный";
    add({ sku, name: `Фильтр ${kind} ${sku}`, brand: "MANN-FILTER", category: "sf-filtry", rubles: 400 + (index % 6) * 120 }, index++);
  }
  for (let n = 0; n < 20; n += 1) {
    add({ sku: `0 986 4${String(52000 + n * 37).padStart(5, "0").slice(0, 2)} ${String(100 + n * 13).slice(0, 3)}`, name: n % 2 ? "Фильтр воздушный" : "Фильтр масляный", brand: "Bosch", category: "sf-filtry", rubles: 450 + n * 10 }, index++);
  }
  for (let n = 0; n < 25; n += 1) {
    add({ sku: `GDB${1600 + n * 7}`, name: `Колодки тормозные ${n % 2 ? "задние" : "передние"} дисковые`, brand: "TRW", category: "sf-tormoznaya-sistema", rubles: 1800 + n * 50 }, index++);
    add({ sku: `DF${4400 + n * 11}`, name: `Диск тормозной ${n % 2 ? "задний" : "передний вентилируемый"}`, brand: "TRW", category: "sf-tormoznaya-sistema", rubles: 2500 + n * 80 }, index++);
  }
  for (let n = 0; n < 20; n += 1) {
    add({ sku: `0 986 49${n % 10} ${String(200 + n * 17)}`, name: `Колодки тормозные дисковые ${n % 2 ? "задние" : "передние"}`, brand: "Bosch", category: "sf-tormoznaya-sistema", rubles: 2000 + n * 60 }, index++);
  }
  for (const sku of ["BPR6ES", "BCPR6ES", "LFR5A-11", "PFR6Q", "ILKAR7B11", "BKR5E-11", "DCPR7E", "IFR6T11"]) {
    add({ sku, name: `Свеча зажигания ${sku}`, brand: "NGK", category: "sf-svechi", rubles: 300 + (index % 5) * 200 }, index++);
  }
  for (const [kind, watt] of [["H1", "55W"], ["H3", "55W"], ["H11", "55W"], ["HB3", "60W"], ["HB4", "51W"], ["D2S", "35W"], ["P21W", "21W"], ["W21/5W", "21/5W"]] as const) {
    add({ sku: `OSR-${kind.replace("/", "")}`, name: `Лампа ${kind} 12V ${watt}`, brand: "Osram", category: "sf-avtolampy", rubles: 150 + (index % 4) * 90 }, index++);
    add({ sku: `PH-${kind.replace("/", "")}`, name: `Лампа ${kind} 12V ${watt} LongLife`, brand: "Philips", category: "sf-avtolampy", rubles: 180 + (index % 4) * 90 }, index++);
  }
  for (const size of [350, 400, 450, 480, 500, 530, 550, 600, 650, 700]) {
    add({ sku: `3 397 008 ${size}`, name: `Щётка стеклоочистителя бескаркасная ${size} мм`, brand: "Bosch", category: "sf-shchetki", rubles: 700 + size }, index++);
    add({ sku: `VF${size}`, name: `Щётка стеклоочистителя гибридная ${size} мм`, brand: "Valeo", category: "sf-shchetki", rubles: 800 + size }, index++);
  }
  for (const [capacity, current] of [[45, 400], [55, 480], [62, 540], [70, 630], [77, 780], [95, 830]] as const) {
    add({ sku: `5${capacity}0${current}`, name: `Аккумулятор Varta Black Dynamic ${capacity}Ач ${current}А`, brand: "Varta", category: "sf-akkumulyatory", rubles: 6000 + capacity * 80 }, index++);
    add({ sku: `0 092 S30 ${capacity}${current % 10}`, name: `Аккумулятор Bosch S3 ${capacity}Ач ${current}А`, brand: "Bosch", category: "sf-akkumulyatory", rubles: 5800 + capacity * 80 }, index++);
  }
  for (const [name, brand] of [
    ["Антифриз G11 зелёный 5 кг", "Felix"], ["Антифриз G12 красный 1 кг", "Sintec"], ["Тосол А-40М 5 кг", "Felix"],
    ["Жидкость тормозная DOT 4 0,91 кг", "Felix"], ["Очиститель карбюратора 400 мл", "Liqui Moly"],
    ["Промывка двигателя 5-минутная 300 мл", "Liqui Moly"], ["Смазка медная 50 г", "Liqui Moly"],
    ["Жидкость стеклоомывателя летняя 4 л", "Sintec"], ["Полироль пластика 400 мл", "Sintec"],
    ["Очиститель стёкол 500 мл", "Sintec"], ["Присадка в топливо для дизеля 250 мл", "Liqui Moly"],
  ] as const) {
    add({ sku: `CHEM-${index}`, name, brand, category: "sf-avtohimiya", rubles: 200 + (index % 7) * 110 }, index++);
  }
  for (const [name, brand] of [
    ["Стойка стабилизатора передняя левая", "Lemförder"], ["Сайлентблок рычага передний", "Lemförder"],
    ["Наконечник рулевой тяги", "Febi Bilstein"], ["Опора амортизатора передняя", "Febi Bilstein"],
    ["Амортизатор задний газовый", "KYB"], ["Подшипник ступицы передний", "Febi Bilstein"],
    ["Ремень поликлиновой 6PK1070", "ContiTech"], ["Термостат с прокладкой", "MAHLE"], ["Помпа водяная", "Febi Bilstein"],
  ] as const) {
    add({ sku: `SUSP-${index}`, name, brand, category: "sf-podveska", rubles: 900 + (index % 9) * 300 }, index++);
  }
  return rows;
}

export const FIXTURE_PRODUCTS: FixtureProduct[] = [...CORE_PRODUCTS, ...generatedProducts()];

interface Queryable {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "x";
}

export async function removeCatalogSearchFixtures(client: Queryable): Promise<void> {
  const like = `${PREFIX}%`;
  await client.query(`DELETE FROM app.inventory_balances WHERE product_id IN (SELECT id FROM app.products WHERE external_id LIKE $1)`, [like]);
  await client.query(`DELETE FROM app.product_prices WHERE product_id IN (SELECT id FROM app.products WHERE external_id LIKE $1)`, [like]);
  await client.query(`DELETE FROM app.products WHERE external_id LIKE $1`, [like]);
  await client.query(`DELETE FROM app.brands WHERE external_id LIKE $1`, [like]);
  await client.query(`DELETE FROM app.categories WHERE external_id LIKE $1`, [like]);
  await client.query(`DELETE FROM app.warehouses WHERE external_id LIKE $1`, [like]);
}

/** Inserts the fixture catalog; returns product key -> sku for assertions. */
export async function seedCatalogSearchFixtures(client: Queryable, products: FixtureProduct[] = FIXTURE_PRODUCTS): Promise<void> {
  await removeCatalogSearchFixtures(client);
  const warehouse = await client.query(
    `INSERT INTO app.warehouses (external_id,code,name) VALUES ($1,'SF-MAIN','Склад фикстуры') RETURNING id`,
    [`${PREFIX}warehouse`],
  );
  const warehouseId = warehouse.rows[0]!.id;
  const categoryIds = new Map<string, unknown>();
  for (const [order, category] of FIXTURE_CATEGORIES.entries()) {
    const row = await client.query(
      `INSERT INTO app.categories (external_id,name,slug,sort_order,is_active) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [`${PREFIX}category:${category.slug}`, category.name, category.slug, order, !("inactive" in category)],
    );
    categoryIds.set(category.slug, row.rows[0]!.id);
  }
  const brandIds = new Map<string, unknown>();
  for (const [order, brand] of FIXTURE_BRANDS.entries()) {
    const row = await client.query(
      `INSERT INTO app.brands (external_id,name,slug,is_active) VALUES ($1,$2,$3,$4) RETURNING id`,
      [`${PREFIX}brand:${order}`, brand, `sf-brand-${order}`, !INACTIVE_BRANDS.has(brand)],
    );
    brandIds.set(brand, row.rows[0]!.id);
  }
  for (const product of products) {
    const row = await client.query(
      `INSERT INTO app.products (external_id,sku,name,slug,brand_id,category_id,search_text,is_active,deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        `${PREFIX}${product.key}`, product.sku, product.name, `sf-${slugify(product.key)}`,
        product.brand ? brandIds.get(product.brand) : null, categoryIds.get(product.category),
        // The same text the 1С exchange writes: the article, the name, and the words the name is read by.
        productSearchText(product.sku, product.name), product.hidden !== "inactive",
        product.hidden === "deleted" ? new Date() : null,
      ],
    );
    const productId = row.rows[0]!.id;
    if (product.rubles !== null) {
      await client.query(`INSERT INTO app.product_prices (product_id,amount_kopeks) VALUES ($1,$2)`, [productId, product.rubles * 100]);
    }
    await client.query(
      `INSERT INTO app.inventory_balances (product_id,warehouse_id,quantity_on_hand) VALUES ($1,$2,$3)`,
      [productId, warehouseId, product.stock],
    );
  }
}

export function fixtureSku(key: string): string {
  const product = FIXTURE_PRODUCTS.find((candidate) => candidate.key === key);
  if (!product) throw new Error(`Unknown search fixture ${key}`);
  return product.sku;
}
