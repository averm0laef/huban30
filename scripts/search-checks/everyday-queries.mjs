// Everyday words customers type for parts, asked of the catalogue search of a running API: how many products each
// finds and how many of the first ten are what the customer meant. The list was written from the owner's
// assortment (22.11.2026); each query carries what the right goods look like — a regular expression over the name.
//
// Usage: node scripts/search-checks/everyday-queries.mjs [API address]      (default http://127.0.0.1:4000)
// Reads only. Waits a second between queries: the API allows a visitor 60 catalogue searches a minute.
// Exit code: 0 — as many queries are answered as on the day the list was measured (74 of 75), 1 — fewer.
const QUERIES = [
  // suspension and steering
  ["стойки", "амортизатор|стойка аморт|стойк[аи] (перед|зад|газ|масл)"],
  ["стойки передние", "амортизатор|стойка"],
  ["граната", "шрус"],
  ["гранаты", "шрус"],
  ["пыльник гранаты", "пыльник.*(шрус|привод)"],
  ["шаровая", "шаров|опора шар"],
  ["шаровые", "шаров|опора шар"],
  ["линки", "стойк[аи] стабилизатор|линк|тяга стабилизатор"],
  ["косточки", "стойк[аи] стабилизатор|линк|тяга стабилизатор"],
  ["сайлент", "сайлентблок|сайлент-блок"],
  // The base spells it «сайлентблок» 1 393 times and «сайленблок» six times: both are the part.
  ["саленблок", "сайлен"],
  ["рулевой наконечник", "наконечник"],
  ["ступичный", "ступи[цч]"],
  ["ступичный подшипник", "подшипник.*ступи|ступи.*подшипник"],
  ["опорник", "опор[аы].*(стойк|аморт)|подшипник опор"],
  ["отбойник", "отбойник"],
  // engine and cooling
  ["помпа", "помпа|насос водян|водян.* насос"],
  ["подушка двигателя", "опор[аы] двиг|подушк[аи] двиг"],
  ["подушка двс", "опор[аы] двиг|подушк[аи] двиг|подушк[аи] двс"],
  ["ремень генератора", "ремень"],
  ["ручейковый ремень", "ремень.*(ручейк|поликлин)|pk"],
  ["прокладка гбц", "прокладк[аи].*(гбц|голов)"],
  ["прокладка клапанной", "прокладк[аи].*клапан"],
  ["маслосъемные", "маслосъ|колпач"],
  ["радиатор печки", "радиатор.*(отопит|печк)"],
  ["моторчик печки", "(мотор|двигател|электродвигател|вентилятор).*(отопит|печк)"],
  ["бачок расширительный", "бач(ок|ка).*расшир|расшир.*бач"],
  ["термостат", "термостат"],
  // ignition and electrics
  ["бронепровода", "провод[аы].*(высоков|в/в|зажиган)"],
  ["катушка", "катушк[аи]"],
  ["свечи", "свеч[аи]"],
  ["лямбда", "лямбд|кислород"],
  ["кислородник", "кислород|лямбд"],
  ["дмрв", "дмрв|расход.*воздух|расходомер"],
  ["бендикс", "бендикс|привод стартер"],
  ["втягивающее", "втягива"],
  ["щетки генератора", "щ[её]тк[аи].*генератор"],
  ["реле поворотов", "реле.*поворот"],
  ["провода прикуривания", "провод[аы].*(пусков|прикур)"],
  ["зарядка акб", "зарядн"],
  // fuel, exhaust
  ["бензонасос", "бензонасос|насос топл|топлив.* насос"],
  ["глушак", "глушител"],
  ["гофра", "гофр"],
  ["резонатор", "резонатор"],
  // transmission and brakes
  ["корзина", "корзин[аы]|диск.*нажим|нажим.*диск"],
  ["корзина сцепления", "корзин[аы]|диск.*нажим|нажим.*диск"],
  ["выжимной", "выжим"],
  ["крестовина", "крестовин"],
  ["подвесной", "подвесн"],
  ["трос ручника", "трос.*(ручн|стояноч)"],
  ["колодки", "колодк"],
  ["гтц", "цилиндр.*торм.*главн|главн.*торм.*цилиндр|гтц"],
  ["рабочий цилиндр", "цилиндр.*(рабоч|сцеплен|торм)"],
  ["тормозной шланг", "шланг.*торм"],
  // filters and fluids
  ["воздушник", "фильтр.*возд"],
  ["салонник", "фильтр.*салон"],
  ["топливник", "фильтр.*топл"],
  ["масло в коробку", "трансмисс|кпп|atf|gear"],
  ["атф", "atf"],
  ["литол", "литол"],
  ["графитка", "графит"],
  ["вд40", "wd-?40"],
  ["вэдэшка", "wd-?40"],
  // body, accessories, tools
  ["поворотник", "поворот"],
  ["подкрылки", "подкрыл|локер"],
  ["брызговики", "брызговик"],
  ["секретки", "секрет"],
  ["оплетка", "оплетк|оплётк"],
  ["вонючка", "ароматизатор|освежител"],
  ["пахучка", "ароматизатор|освежител"],
  // «Ключ балонный» is typed with one «л» in 49 names of the base and with two in 26.
  ["балонник", "бал+онн"],
  ["баллонный ключ", "бал+онн"],
  ["трещотка", "трещотк"],
  ["прикуриватель", "прикуривател"],
  ["холодная сварка", "сварк"],
];

/** How many of the queries gave the right goods when the list was last measured on the owner's assortment. */
const EXPECTED = 74;
const base = (process.argv[2] ?? "http://127.0.0.1:4000").replace(/\/$/u, "");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let good = 0;
const rows = [];
for (const [query, expected] of QUERIES) {
  const url = `${base}/api/v1/catalog/products?q=${encodeURIComponent(query)}&limit=10`;
  let response = await fetch(url);
  if (response.status === 429) { await wait(61_000); response = await fetch(url); }
  if (!response.ok) { rows.push(`${query}\tHTTP ${response.status}`); await wait(1100); continue; }
  const data = await response.json();
  const pattern = new RegExp(expected, "iu");
  const names = data.items.map((item) => item.name.replace(/\s+/gu, " ").trim());
  const hits = names.filter((name) => pattern.test(name.replace(/ё/giu, "е"))).length;
  const verdict = names.length === 0 ? "NOTHING" : hits >= Math.min(7, names.length) ? "ok" : hits >= 3 ? "mixed" : "WRONG";
  if (verdict === "ok") good += 1;
  rows.push(`${verdict}\t${query}\tfound ${data.total}${data.matchMode === "any" ? " (any word)" : ""}\t${hits}/${names.length} of the first ten\t${names.slice(0, 3).map((name) => name.slice(0, 46)).join(" ¦ ")}`);
  await wait(1100);
}
console.log(rows.join("\n"));
console.log(`\nqueries: ${QUERIES.length} | the first ten are what was meant: ${good} (measured on 23.11.2026: ${EXPECTED})`);
process.exitCode = good >= EXPECTED ? 0 : 1;
