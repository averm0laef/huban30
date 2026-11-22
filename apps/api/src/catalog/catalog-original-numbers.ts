/**
 * What an original part number says about the part.
 *
 * Japanese and Korean car makers number parts as «48815-60111»: the first
 * five digits are the part's code (what it is), the rest says which car it is
 * for. Sellers of analogues keep the number in their own («TG-48815-60121»,
 * «ST-42450-52060»), and the shop's 1С often has nothing else to go by:
 * «Втулка TG-48815-60121 * Ti·GUAR» does not say which bush it is.
 *
 * The table below was made from the shop's own base (export of 2026-11-22):
 * a code is listed only when the items that carry it AND have a telling name
 * agree on one shelf — at least eight items, at least 95 % of them
 * (scripts/catalog-placement/original-number-codes.mjs prints the candidates;
 * every line here was then read by eye). Codes that name different parts («90919» is
 * ignition coils, leads and sensors alike) are left out on purpose. Nothing
 * here comes from an external parts catalogue.
 *
 * Honda writes its numbers differently — «51306-S47-003»: five digits, three
 * characters, three characters — and its codes are its own («42200» is a hub
 * for Honda), so they have a table of their own, made the same way.
 *
 * The answer is used only when the product's name and its 1С group do not
 * decide (catalog-known-categories.ts); a wrong shelf is worse than the queue.
 */

/** Shelf slug → the part codes that mean it. */
const CODES_BY_SHELF: Readonly<Record<string, readonly string[]>> = {
  stabilizator: ["48815", "48818", "48820", "48830", "54613", "54618", "42412"],
  saylentbloki: ["48654", "48655", "48725"],
  rychagi: ["48069", "48190", "48730"],
  "sharovye-opory": ["43330", "43340", "40160"],
  "opory-i-pylniki": ["48609", "48157", "48257", "48331", "54320"],
  "stupitsy-i-podshipniki": ["42410", "42450", "43502"],
  "rulevye-nakonechniki": ["45046", "45047"],
  "rulevye-tyagi": ["45503"],
  "rulevye-reyki-i-gur": ["45535"],
  "rulevye-mehanizmy": ["45260"],
  "tormoznye-kolodki": ["04465", "04495"],
  "tormoznye-diski": ["43512", "40206"],
  "tormoznye-shlangi": ["90947", "46210"],
  "supporty-i-remkomplekty": ["04478", "04479", "47715", "47730", "47750", "41120"],
  "prokladki-i-salniki": ["04111", "10101", "11044", "11115", "22271"],
  "opory-dvigatelya": ["12305", "12371"],
  "roliki-i-natyazhiteli": ["16620"],
  "vpusknaya-sistema": ["12204"],
  "maslyanye-filtry": ["04152", "15208"],
  "vozdushnye-filtry": ["17801", "16546", "13780"],
  "salonnye-filtry": ["87139"],
  "toplivnye-filtry": ["23217", "77024"],
  "filtry-akpp-i-gidravliki": ["35303", "35330", "31728"],
  "krestoviny-i-podshipniki": ["04371"],
  "kardannye-valy": ["37230"],
  "patrubki-i-shlangi": ["16571"],
  termostaty: ["21200"],
  "generatory-i-startery": ["27060", "27370", "28100"],
  datchiki: ["23731"],
  "vyklyuchateli-i-provodka": ["84306"],
  "gofry-i-krepleniya": ["17451"],
  "gazovye-upory": ["68950", "68960"],
  "kolesnyy-krepezh": ["90942"],
};

const SHELF_BY_CODE: ReadonlyMap<string, string> = new Map(
  Object.entries(CODES_BY_SHELF).flatMap(([slug, codes]) => codes.map((code) => [code, slug] as const)),
);

/**
 * «48815-60111», also behind a seller's prefix («TG-48815-60121», «STP-90910-02101»): five digits, a dash, five
 * letters or digits, standing as a number of its own.
 */
const ORIGINAL_NUMBER = /(?:^|[^0-9A-Za-zА-Яа-яЁё])(?:[A-Za-z]{1,3}-)?(\d{5})-[0-9A-Za-z]{5}(?![0-9A-Za-zА-Яа-яЁё-])/u;

/** Honda's «51306-S47-003», also behind a seller's prefix («TG-51306-S47-003»). */
const HONDA_NUMBER = /(?:^|[^0-9A-Za-zА-Яа-яЁё])(?:[A-Za-z]{1,3}-)?(\d{5})-[0-9A-Za-z]{3}-[0-9A-Za-z]{3}(?![0-9A-Za-zА-Яа-яЁё-])/u;

/** Shelf slug → Honda's part codes that mean it. */
const HONDA_CODES_BY_SHELF: Readonly<Record<string, readonly string[]>> = {
  stabilizator: ["51306"],
  "vozdushnye-filtry": ["17220"],
  "rulevye-tyagi": ["53010"],
  "rulevye-nakonechniki": ["53540"],
  "tormoznye-shlangi": ["01464"],
  "prokladki-i-salniki": ["12251"],
  "stupitsy-i-podshipniki": ["42200"],
};

const HONDA_SHELF_BY_CODE: ReadonlyMap<string, string> = new Map(
  Object.entries(HONDA_CODES_BY_SHELF).flatMap(([slug, codes]) => codes.map((code) => [code, slug] as const)),
);

/** The part code of the first original number in the text («Втулка TG-48815-60121» → «48815»), or null. */
export function originalPartCode(text: string): string | null {
  return ORIGINAL_NUMBER.exec(text)?.[1] ?? null;
}

/** The shelf the text's original number points at, or null when it has none or its code is not a reliable witness. */
export function shelfByOriginalNumber(text: string): string | null {
  const code = originalPartCode(text);
  if (code) return SHELF_BY_CODE.get(code) ?? null;
  const honda = HONDA_NUMBER.exec(text)?.[1];
  return honda ? HONDA_SHELF_BY_CODE.get(honda) ?? null : null;
}

/** Every shelf the tables answer with: checked against the storefront tree in the tests. */
export function originalNumberShelves(): ReadonlyMap<string, string> {
  return new Map([...SHELF_BY_CODE, ...[...HONDA_SHELF_BY_CODE].map(([code, slug]) => [`honda:${code}`, slug] as const)]);
}
