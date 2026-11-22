/**
 * Starter list of makes and models for the picker and typeahead, compiled by
 * hand for the shop's region: right-hand-drive Japanese cars first, then
 * European makes, then the rest of the Russian market. It is a convenience list,
 * not a fitment source: modifications, years and engines come from FAPI.
 * `rank` orders the «Популярные марки» row; null = alphabetical only.
 */

export interface SeedMake {
  country: string;
  models: readonly string[];
  name: string;
  nameRu: string;
  rank: number | null;
  slug: string;
}

export const VEHICLE_SEED: readonly SeedMake[] = [
  { slug: "lada", name: "LADA", nameRu: "Лада", country: "Россия", rank: 23, models: ["Granta", "Vesta", "Niva Legend", "Niva Travel", "Largus", "XRAY", "Kalina", "Priora", "2107", "2110", "2114", "4x4", "Iskra", "Aura"] },
  { slug: "toyota", name: "Toyota", nameRu: "Тойота", country: "Япония", rank: 1, models: ["Camry", "Corolla", "RAV4", "Land Cruiser", "Land Cruiser Prado", "Highlander", "Probox", "Succeed", "Yaris", "Vitz", "Prius", "Fortuner", "Hilux", "Auris", "Avensis", "C-HR", "Alphard", "Noah", "Voxy", "Allion", "Premio", "Harrier", "Mark II", "Crown"] },
  { slug: "kia", name: "Kia", nameRu: "Киа", country: "Корея", rank: 22, models: ["Rio", "Ceed", "Cerato", "Optima", "K5", "Sportage", "Sorento", "Soul", "Seltos", "Picanto", "Carnival", "Mohave", "Stinger"] },
  { slug: "hyundai", name: "Hyundai", nameRu: "Хендай", country: "Корея", rank: 21, models: ["Solaris", "Creta", "Elantra", "Sonata", "Tucson", "Santa Fe", "i30", "i40", "ix35", "Getz", "Accent", "Porter", "Starex", "Palisade"] },
  { slug: "volkswagen", name: "Volkswagen", nameRu: "Фольксваген", country: "Германия", rank: 11, models: ["Polo", "Golf", "Jetta", "Passat", "Tiguan", "Touareg", "Teramont", "Caddy", "Transporter", "Multivan", "Amarok", "Touran"] },
  { slug: "renault", name: "Renault", nameRu: "Рено", country: "Франция", rank: 17, models: ["Logan", "Sandero", "Sandero Stepway", "Duster", "Kaptur", "Arkana", "Megane", "Fluence", "Koleos", "Kangoo", "Symbol", "Clio"] },
  { slug: "skoda", name: "Skoda", nameRu: "Шкода", country: "Чехия", rank: 18, models: ["Octavia", "Rapid", "Fabia", "Superb", "Kodiaq", "Karoq", "Yeti", "Roomster"] },
  { slug: "nissan", name: "Nissan", nameRu: "Ниссан", country: "Япония", rank: 2, models: ["Almera", "Qashqai", "X-Trail", "Juke", "Note", "Tiida", "Teana", "Murano", "Pathfinder", "Terrano", "Patrol", "Sentra", "Primera", "Micra", "AD", "Wingroad", "Serena", "Leaf"] },
  { slug: "haval", name: "Haval", nameRu: "Хавал", country: "Китай", rank: null, models: ["Jolion", "F7", "F7x", "H6", "H9", "Dargo", "M6", "H2"] },
  { slug: "chery", name: "Chery", nameRu: "Чери", country: "Китай", rank: null, models: ["Tiggo 4", "Tiggo 7 Pro", "Tiggo 8", "Tiggo 8 Pro", "Tiggo 2", "Tiggo 3", "Arrizo 8", "Very", "Bonus"] },
  { slug: "geely", name: "Geely", nameRu: "Джили", country: "Китай", rank: null, models: ["Coolray", "Monjaro", "Atlas", "Atlas Pro", "Tugella", "Emgrand", "Okavango", "Preface", "MK"] },
  { slug: "mitsubishi", name: "Mitsubishi", nameRu: "Митсубиси", country: "Япония", rank: 4, models: ["Lancer", "Outlander", "ASX", "Pajero", "Pajero Sport", "L200", "Galant", "Colt", "Eclipse Cross", "Delica"] },
  { slug: "mazda", name: "Mazda", nameRu: "Мазда", country: "Япония", rank: 5, models: ["3", "6", "CX-5", "CX-7", "CX-9", "CX-30", "Demio", "Axela", "Atenza", "MPV", "Premacy", "Bongo"] },
  { slug: "honda", name: "Honda", nameRu: "Хонда", country: "Япония", rank: 3, models: ["Civic", "Accord", "CR-V", "Fit", "Jazz", "HR-V", "Pilot", "Stepwgn", "Freed", "Odyssey", "Vezel", "Stream"] },
  { slug: "ford", name: "Ford", nameRu: "Форд", country: "США", rank: 16, models: ["Focus", "Mondeo", "Fiesta", "Fusion", "Kuga", "EcoSport", "Explorer", "Transit", "Tourneo", "Ranger", "C-Max", "S-Max", "Galaxy"] },
  { slug: "chevrolet", name: "Chevrolet", nameRu: "Шевроле", country: "США", rank: null, models: ["Niva", "Lanos", "Aveo", "Cruze", "Lacetti", "Captiva", "Cobalt", "Spark", "Orlando", "Tahoe", "Trailblazer"] },
  { slug: "uaz", name: "UAZ", nameRu: "УАЗ", country: "Россия", rank: 24, models: ["Patriot", "Hunter", "Pickup", "Profi", "Буханка (452)", "469", "3909", "Cargo"] },
  { slug: "gaz", name: "GAZ", nameRu: "ГАЗ", country: "Россия", rank: null, models: ["Газель", "Газель Next", "Газель Бизнес", "Соболь", "Соболь NN", "Валдай", "Волга 3110", "Волга 31105", "Siber", "Садко"] },
  { slug: "bmw", name: "BMW", nameRu: "БМВ", country: "Германия", rank: 12, models: ["1 Series", "3 Series", "5 Series", "7 Series", "X1", "X3", "X5", "X6", "X7"] },
  { slug: "mercedes-benz", name: "Mercedes-Benz", nameRu: "Мерседес", country: "Германия", rank: 13, models: ["A-Class", "B-Class", "C-Class", "E-Class", "S-Class", "CLA", "CLS", "CLK", "GLA", "GLB", "GLC", "GLE", "GLK", "GLS", "ML", "GL", "G-Class", "Vito", "Viano", "Sprinter", "V-Class", "SLK", "190", "W124", "W140", "W202", "W203", "W204", "W210", "W211", "W212"] },
  { slug: "audi", name: "Audi", nameRu: "Ауди", country: "Германия", rank: 14, models: ["A1", "A3", "A4", "A5", "A6", "A7", "A8", "Q3", "Q5", "Q7", "Q8", "TT", "80", "100", "Allroad"] },
  { slug: "changan", name: "Changan", nameRu: "Чанган", country: "Китай", rank: null, models: ["CS35 Plus", "CS55 Plus", "CS75 Plus", "CS85", "UNI-K", "UNI-T", "UNI-V", "Eado", "Alsvin", "Hunter Plus"] },
  { slug: "exeed", name: "EXEED", nameRu: "Эксид", country: "Китай", rank: null, models: ["LX", "TXL", "VX", "RX"] },
  { slug: "omoda", name: "OMODA", nameRu: "Омода", country: "Китай", rank: null, models: ["C5", "S5", "C7"] },
  { slug: "jaecoo", name: "Jaecoo", nameRu: "Джейку", country: "Китай", rank: null, models: ["J7", "J8"] },
  { slug: "tank", name: "Tank", nameRu: "Танк", country: "Китай", rank: null, models: ["300", "400", "500"] },
  { slug: "jac", name: "JAC", nameRu: "Джак", country: "Китай", rank: null, models: ["J7", "JS4", "JS6", "S3", "S5", "T6", "T8", "N56", "N80"] },
  { slug: "faw", name: "FAW", nameRu: "ФАВ", country: "Китай", rank: null, models: ["Bestune T77", "Bestune B70", "Besturn X80", "Oley", "V5"] },
  { slug: "dongfeng", name: "Dongfeng", nameRu: "Донгфенг", country: "Китай", rank: null, models: ["580", "AX7", "Shine Max", "H30 Cross"] },
  { slug: "gac", name: "GAC", nameRu: "ГАК", country: "Китай", rank: null, models: ["GS3", "GS8", "GN8", "M8"] },
  { slug: "byd", name: "BYD", nameRu: "БИД", country: "Китай", rank: null, models: ["Song Plus", "Han", "Tang", "Qin Plus", "Seal", "Yuan Plus", "F3"] },
  { slug: "lifan", name: "Lifan", nameRu: "Лифан", country: "Китай", rank: null, models: ["Solano", "X60", "X50", "Smily", "Breez", "Cebrium", "Myway"] },
  { slug: "great-wall", name: "Great Wall", nameRu: "Грейт Волл", country: "Китай", rank: null, models: ["Hover", "Hover H3", "Hover H5", "Wingle", "Safe", "Poer"] },
  { slug: "datsun", name: "Datsun", nameRu: "Датсун", country: "Япония", rank: null, models: ["on-DO", "mi-DO"] },
  { slug: "lexus", name: "Lexus", nameRu: "Лексус", country: "Япония", rank: 10, models: ["RX", "NX", "LX", "GX", "ES", "IS", "GS", "LS", "UX", "CT", "SC", "HS", "RC"] },
  { slug: "infiniti", name: "Infiniti", nameRu: "Инфинити", country: "Япония", rank: null, models: ["FX", "EX", "QX50", "QX56", "QX60", "QX70", "QX80", "G", "M", "Q50", "Q70", "JX"] },
  { slug: "subaru", name: "Subaru", nameRu: "Субару", country: "Япония", rank: 6, models: ["Forester", "Outback", "Legacy", "Impreza", "XV", "Tribeca", "Exiga", "Levorg", "Lancaster", "Pleo", "Sambar", "Stella", "R1", "R2", "Traviq", "Domingo", "Leone", "Justy", "Vivio", "WRX", "BRZ", "Dex", "Trezia"] },
  { slug: "suzuki", name: "Suzuki", nameRu: "Сузуки", country: "Япония", rank: 7, models: ["Grand Vitara", "Vitara", "SX4", "Swift", "Jimny", "Escudo", "Wagon R", "Alto", "Every", "Solio", "Kei", "Ignis", "Liana", "Aerio", "Baleno", "Splash", "Hustler", "Spacia", "Carry", "Cultus", "Kizashi", "Lapin", "MR Wagon", "Palette", "Cervo", "Landy"] },
  { slug: "daewoo", name: "Daewoo", nameRu: "Дэу", country: "Корея", rank: null, models: ["Nexia", "Matiz", "Gentra", "Lanos", "Espero"] },
  { slug: "ssangyong", name: "SsangYong", nameRu: "Ссанг Йонг", country: "Корея", rank: null, models: ["Kyron", "Actyon", "Rexton", "Korando", "Musso"] },
  { slug: "opel", name: "Opel", nameRu: "Опель", country: "Германия", rank: 15, models: ["Astra", "Corsa", "Vectra", "Insignia", "Zafira", "Meriva", "Mokka", "Antara", "Omega", "Combo", "Vivaro", "Frontera", "Movano", "Signum", "Tigra"] },
  { slug: "peugeot", name: "Peugeot", nameRu: "Пежо", country: "Франция", rank: 20, models: ["106", "206", "207", "208", "301", "306", "307", "308", "406", "407", "408", "508", "607", "2008", "3008", "4007", "4008", "5008", "Partner", "Boxer", "Expert"] },
  { slug: "citroen", name: "Citroen", nameRu: "Ситроен", country: "Франция", rank: null, models: ["C1", "C2", "C3", "C4", "C5", "C6", "C8", "C-Elysee", "C-Crosser", "Berlingo", "Jumper", "Jumpy", "C4 Picasso", "Xsara", "Xantia", "DS3", "DS4"] },
  { slug: "fiat", name: "Fiat", nameRu: "Фиат", country: "Италия", rank: null, models: ["Albea", "Doblo", "Ducato", "Punto", "Linea", "Panda", "Bravo", "Stilo", "500", "Scudo", "Fiorino", "Tipo"] },
  { slug: "volvo", name: "Volvo", nameRu: "Вольво", country: "Швеция", rank: 19, models: ["XC60", "XC90", "XC70", "XC40", "S40", "S60", "S80", "S90", "V40", "V50", "V60", "V70", "V90", "C30", "850", "940"] },
  { slug: "land-rover", name: "Land Rover", nameRu: "Ленд Ровер", country: "Великобритания", rank: null, models: ["Range Rover", "Range Rover Sport", "Range Rover Evoque", "Range Rover Velar", "Discovery", "Discovery Sport", "Freelander", "Defender"] },
  { slug: "porsche", name: "Porsche", nameRu: "Порше", country: "Германия", rank: null, models: ["Cayenne", "Macan", "Panamera", "911", "Boxster", "Cayman"] },
  { slug: "jeep", name: "Jeep", nameRu: "Джип", country: "США", rank: null, models: ["Grand Cherokee", "Cherokee", "Compass", "Wrangler", "Renegade"] },
  { slug: "moskvich", name: "Moskvich", nameRu: "Москвич", country: "Россия", rank: null, models: ["3", "3e", "6", "2141", "412", "2140"] },
  { slug: "zaz", name: "ZAZ", nameRu: "ЗАЗ", country: "Украина", rank: null, models: ["Chance", "Sens", "Vida", "Forza", "Таврия"] },
  { slug: "izh", name: "IZH", nameRu: "ИЖ", country: "Россия", rank: null, models: ["2126 Ода", "2717", "2715"] },
  { slug: "tagaz", name: "TagAZ", nameRu: "ТагАЗ", country: "Россия", rank: null, models: ["Tager", "Road Partner", "Vortex Tingo", "Vortex Estina"] },
  { slug: "evolute", name: "Evolute", nameRu: "Эволют", country: "Россия", rank: null, models: ["i-Pro", "i-Joy", "i-Sky"] },
  { slug: "solaris", name: "Solaris", nameRu: "Соларис", country: "Россия", rank: null, models: ["HS", "KRS", "KRX"] },
  { slug: "tenet", name: "Tenet", nameRu: "Тенет", country: "Россия", rank: null, models: ["T4", "T7", "T8"] },
  { slug: "kamaz", name: "KAMAZ", nameRu: "КАМАЗ", country: "Россия", rank: null, models: ["Компас", "5490", "65115"] },
  { slug: "seat", name: "SEAT", nameRu: "Сеат", country: "Испания", rank: null, models: ["Ibiza", "Leon", "Altea", "Toledo", "Cordoba", "Alhambra", "Ateca"] },
  { slug: "mini", name: "MINI", nameRu: "Мини", country: "Великобритания", rank: null, models: ["Cooper", "Countryman", "Clubman", "One", "Paceman"] },
  { slug: "cadillac", name: "Cadillac", nameRu: "Кадиллак", country: "США", rank: null, models: ["Escalade", "SRX", "XT5", "CTS"] },
  // Other makes serviced in Russia: models, years and engines come from FAPI (TecDoc).
  { slug: "acura", name: "Acura", nameRu: "Акура", country: "Япония", rank: null, models: ["MDX", "RDX", "TLX", "TSX", "ILX", "RL", "TL", "ZDX", "Integra"] },
  { slug: "alfa-romeo", name: "Alfa Romeo", nameRu: "Альфа Ромео", country: "Италия", rank: null, models: ["147", "156", "159", "166", "Giulietta", "Giulia", "Stelvio", "MiTo", "GT"] },
  { slug: "baic", name: "BAIC", nameRu: "БАИК", country: "Китай", rank: null, models: [] },
  { slug: "brilliance", name: "Brilliance", nameRu: "Брилианс", country: "Китай", rank: null, models: [] },
  { slug: "buick", name: "Buick", nameRu: "Бьюик", country: "США", rank: null, models: [] },
  { slug: "chrysler", name: "Chrysler", nameRu: "Крайслер", country: "США", rank: null, models: [] },
  { slug: "daihatsu", name: "Daihatsu", nameRu: "Дайхатсу", country: "Япония", rank: 8, models: ["Terios", "Terios Kid", "Move", "Mira", "Hijet", "Atrai", "YRV", "Storia", "Boon", "Be-go", "Tanto", "Sirion", "Charade", "Cuore", "Rocky", "Feroza", "Materia", "Coo", "Pyzar", "Applause", "Naked", "Esse", "Copen", "Sonica", "Delta"] },
  { slug: "dodge", name: "Dodge", nameRu: "Додж", country: "США", rank: null, models: [] },
  { slug: "foton", name: "Foton", nameRu: "Фотон", country: "Китай", rank: null, models: [] },
  { slug: "genesis", name: "Genesis", nameRu: "Дженезис", country: "Корея", rank: null, models: [] },
  { slug: "gmc", name: "GMC", nameRu: "ДжиЭмСи", country: "США", rank: null, models: [] },
  { slug: "hongqi", name: "Hongqi", nameRu: "Хончи", country: "Китай", rank: null, models: [] },
  { slug: "hummer", name: "Hummer", nameRu: "Хаммер", country: "США", rank: null, models: [] },
  { slug: "isuzu", name: "Isuzu", nameRu: "Исузу", country: "Япония", rank: 9, models: ["Bighorn", "Elf", "Wizard", "Forward", "D-Max", "MU", "MU-X", "Trooper", "Rodeo", "Gemini", "Aska", "Fargo", "Como", "VehiCross", "Axiom"] },
  { slug: "iveco", name: "Iveco", nameRu: "Ивеко", country: "Италия", rank: null, models: ["Daily", "Eurocargo"] },
  { slug: "jaguar", name: "Jaguar", nameRu: "Ягуар", country: "Великобритания", rank: null, models: ["XF", "XJ", "XE", "X-Type", "S-Type", "F-Pace", "E-Pace", "XK"] },
  { slug: "jetour", name: "Jetour", nameRu: "Джетур", country: "Китай", rank: null, models: [] },
  { slug: "kaiyi", name: "Kaiyi", nameRu: "Кайи", country: "Китай", rank: null, models: [] },
  { slug: "lancia", name: "Lancia", nameRu: "Лянча", country: "Италия", rank: null, models: ["Delta", "Ypsilon", "Lybra", "Musa", "Thesis"] },
  { slug: "lincoln", name: "Lincoln", nameRu: "Линкольн", country: "США", rank: null, models: [] },
  { slug: "livan", name: "Livan", nameRu: "Ливан", country: "Китай", rank: null, models: [] },
  { slug: "maserati", name: "Maserati", nameRu: "Мазерати", country: "Италия", rank: null, models: [] },
  { slug: "ravon", name: "Ravon", nameRu: "Равон", country: "Узбекистан", rank: null, models: [] },
  { slug: "rover", name: "Rover", nameRu: "Ровер", country: "Великобритания", rank: null, models: ["25", "45", "75", "200", "400", "600"] },
  { slug: "saab", name: "Saab", nameRu: "Сааб", country: "Швеция", rank: null, models: ["9-3", "9-5", "900", "9000"] },
  { slug: "smart", name: "Smart", nameRu: "Смарт", country: "Германия", rank: null, models: ["Fortwo", "Forfour", "Roadster"] },
  { slug: "soueast", name: "Soueast", nameRu: "Соуист", country: "Китай", rank: null, models: [] },
  { slug: "tesla", name: "Tesla", nameRu: "Тесла", country: "США", rank: null, models: [] },
  { slug: "vortex", name: "Vortex", nameRu: "Вортекс", country: "Россия", rank: null, models: [] },
  { slug: "voyah", name: "Voyah", nameRu: "Воя", country: "Китай", rank: null, models: [] },
  { slug: "zeekr", name: "Zeekr", nameRu: "Зикр", country: "Китай", rank: null, models: [] },
  { slug: "zotye", name: "Zotye", nameRu: "Зотти", country: "Китай", rank: null, models: [] },
  { slug: "dacia", name: "Dacia", nameRu: "Дачия", country: "Румыния", rank: null, models: ["Logan", "Sandero", "Duster", "Lodgy", "Dokker"] },
  { slug: "alpina", name: "Alpina", nameRu: "Альпина", country: "Германия", rank: null, models: [] },
  { slug: "bentley", name: "Bentley", nameRu: "Бентли", country: "Великобритания", rank: null, models: [] },
  { slug: "ssangyong-kgm", name: "KGM", nameRu: "КГМ", country: "Корея", rank: null, models: [] },
];

/** URL-safe slug for a model name (Latin only; Cyrillic is transliterated). */
export function slugify(value: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
    н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
    ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return [...value.toLowerCase()].map((char) => map[char] ?? char).join("")
    .replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "") || "model";
}
