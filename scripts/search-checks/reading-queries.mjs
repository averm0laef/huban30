// Queries by the proper word for products whose names in the owner's 1С are typed with shorthand («аром-р»,
// «предохр.», «п/син») or with a Latin letter that looks like a Russian one («Cальник»): is the product each is
// meant for among the first five? The exchange adds the words such a name is read by to its search text
// (apps/api/src/catalog/catalog-search-reading.ts); before that, 11 of these 26 queries found their product.
//
// Usage: node scripts/search-checks/reading-queries.mjs [API address]      (default http://127.0.0.1:4000)
// Needs the owner's assortment behind the API (the products are named by their real names). Reads only.
// Exit code: 0 — as many products are found as on the day the list was measured (22 of 26), 1 — fewer.
const READING_QUERIES = [
  // a Latin look-alike letter
  ["сальник привода ncp1", "^cальник привода fr ty ncp1"],
  ["ремень автомобильный", "^pемень автомобильный"],
  ["наконечник тяги рулевой volvo", "^hаконечник тяги рулевой"],
  ["масло моторное totachi grand touring", "^mасло моторное totachi grand touring"],
  ["смазка nano blue", "^cмазка nano blue"],
  ["насос для автономки", "^hасос для автономки"],
  ["стекломат novol", "^cтекломат novol"],
  ["тяга переднего стабилизатора volvo", "^tяга переднего стабилизатора volvo"],
  ["монтировка эврика", "^mонтировка 750мм эврика"],
  // 1С shorthand
  ["ароматизатор aura fresh", "^аром-р aura fresh"],
  ["предохранитель masuma", "^предохр\\. masuma"],
  ["полусинтетическое helix hx7", "helix hx7 5w30 бенз \\(п/син\\)"],
  ["фильтр топливный fc-236", "^фильтр топл\\.fc-236"],
  ["фильтр воздушный afau009", "^фильтр воздуш ваз 2108"],
  ["провода высоковольтные 2123", "^провода в/в 2123"],
  ["клемма акб комплект", "^клемма акб .*\\(к-т 2шт\\)"],
  ["тормозная жидкость нева", "торм\\. жидк\\. нева"],
  ["проставка амортизатор belta", "^проставка под стойку аморт\\."],
  ["уплотнительное кольцо masuma", "^упл\\.кольцо под вых\\.коллект\\. masuma"],
  ["сигнал звуковой volga", "сигн\\.звуковые м5 volga"],
  ["жидкость гидроусилителя step-up", "жидкость гидроус\\.руля step-up"],
  ["ремкомплект штуцера трубки", "^рем\\.комплект штуцера трубки"],
  ["пыльник рулевой рейки tiguar", "^пыльник рул\\. рейки tg-2002"],
  ["бумага наждачная daesang", "бумага нажд\\. .daesang"],
  ["синтетическое tcl zero line", "tcl zero line 5w30, синт"],
  ["минеральное luxe standart", "luxe масло моторное стандарт .* мин\\."],
];

/** How many of the products were found when the list was last measured on the owner's assortment. */
const EXPECTED = 22;
const base = (process.argv[2] ?? "http://127.0.0.1:4000").replace(/\/$/u, "");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let found = 0;
const rows = [];
for (const [query, expected] of READING_QUERIES) {
  const url = `${base}/api/v1/catalog/products?q=${encodeURIComponent(query)}&limit=10`;
  let response = await fetch(url);
  if (response.status === 429) { await wait(61_000); response = await fetch(url); }
  if (!response.ok) { rows.push(`HTTP ${response.status}\t${query}`); await wait(1100); continue; }
  const data = await response.json();
  const pattern = new RegExp(expected, "iu");
  const names = data.items.map((item) => item.name.replace(/\s+/gu, " ").trim());
  const position = names.findIndex((name) => pattern.test(name)) + 1;
  const verdict = position >= 1 && position <= 5 ? "found" : position > 5 ? "LOW" : "MISSING";
  if (verdict === "found") found += 1;
  rows.push(`${verdict}\t${query}\tfound ${data.total}${data.matchMode === "any" ? " (any word)" : ""}\tplace ${position || "—"}\tfirst: ${(names[0] ?? "—").slice(0, 60)}`);
  await wait(1100);
}
console.log(rows.join("\n"));
console.log(`\nqueries: ${READING_QUERIES.length} | the product is among the first five: ${found} (measured on 22.11.2026: ${EXPECTED})`);
process.exitCode = found >= EXPECTED ? 0 : 1;
