/**
 * What a 1С name says about the part: side and axle, a lamp's type, voltage and base, a belt's or a bearing's
 * standard size, a seal's dimensions, a wiper's length, a battery's capacity and polarity, an oil's viscosity and
 * volume, a tyre's size (docs/CATALOG_MATCHING.md, «Признаки»). A feature is written only when the name says it once
 * and plainly: «прав/лев» is both sides and says nothing, «4л/5л» is two volumes.
 *
 * Two uses: two products whose features differ are never one part or an analog (a 24 V lamp is not a 12 V one, a
 * left bracket is not a right one), and a standard size (partSizeKey) makes parts of any maker interchangeable.
 */

import { partHeadNoun } from "./catalog-part-dictionary.js";

export interface PartSpecs {
  axle?: "front" | "rear";
  bearing?: string;
  belt?: string;
  capacityAh?: number;
  lampBase?: string;
  lampType?: string;
  lengthMm?: number;
  level?: "lower" | "upper";
  polarity?: "direct" | "reverse";
  seal?: string;
  side?: "left" | "right";
  tyreSize?: string;
  viscosity?: string;
  voltage?: number;
  volumeLitres?: number;
  watts?: string;
}

/** The one value the pattern finds in the text, or null when it finds none or several different ones. */
function only(text: string, pattern: RegExp, read: (match: RegExpExecArray) => string | null): string | null {
  const found = new Set<string>();
  for (const match of text.matchAll(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`))) {
    const value = read(match);
    if (value) found.add(value);
  }
  return found.size === 1 ? [...found][0]! : null;
}

function either<T extends string>(tokens: readonly string[], first: [T, (token: string) => boolean], second: [T, (token: string) => boolean]): T | null {
  const one = tokens.some(first[1]);
  const other = tokens.some(second[1]);
  return one === other ? null : one ? first[0] : second[0];
}

const inFormsOf = (stem: string) => (token: string) => token === stem || (token.startsWith(stem) && /^(?:ый|ая|ое|ые|ого|ой|ую|ее|ей|ие|яя|ий)$/u.test(token.slice(stem.length)));
const number = (value: string) => Number(value.replace(",", "."));
const size = (value: string) => value.replace(",", ".").replace(/^0+(?=\d)/u, "");

const LAMP_TYPE = /(?<![a-z0-9])(h(?:1|2|3|4|7|8|9|10|11|13|15|16|27)w?(?:\/\d)?|hb[1-5]|hir2|d[1-8][sr]|(?:wy?|py?|r|t|c|h)\d{1,2}(?:[.,]\d)?(?:\/\d{1,2})?w)(?![a-z0-9])/u;
const LAMP_BASE = /(?<![a-z0-9])(ba[yuz]?\d{1,2}[sd]|px?\d{2}(?:[.,]\d)?[stdf](?:-\d{1,2})?|pg?j\d{2}(?:-\d{1,2})?|pk\d{2}[sd]|w\d[.,]\d\s?x\s?\d{1,2}(?:[.,]\d)?d|sv\d(?:[.,]\d)?)(?![a-z0-9])/u;

export function partSpecs(name: string): PartSpecs {
  const text = name.toLowerCase().replace(/ё/gu, "е").replace(/(?<=\d\s?)[х×*](?=\s?\d)/gu, "x");
  const tokens = text.split(/[^a-zа-я0-9]+/u).filter(Boolean);
  const has = (pattern: RegExp) => pattern.test(text);
  // A lamp's, a belt's, a bearing's or a seal's size is read only from that part's own name: «Рычаг … на
  // подшипниках (6059)», «Патрон лампы H7» are not a bearing and a lamp.
  const head = partHeadNoun(name) ?? "";
  const isPart = (stem: RegExp) => stem.test(head);
  const specs: PartSpecs = {};

  const side = either(tokens, ["left", (token) => token === "lh" || token === "лев" || inFormsOf("лев")(token)], ["right", (token) => token === "rh" || token === "прав" || inFormsOf("прав")(token)]);
  if (side) specs.side = side;
  const axle = either(tokens, ["front", (token) => token === "пер" || token === "перед" || token === "fr" || inFormsOf("передн")(token)], ["rear", (token) => token === "зад" || token === "rr" || inFormsOf("задн")(token)]);
  if (axle) specs.axle = axle;
  const level = either(tokens, ["upper", (token) => token === "верх" || inFormsOf("верхн")(token)], ["lower", inFormsOf("нижн")]);
  if (level) specs.level = level;

  const voltage = only(text, /(?<![\d.,/])(6|12|24)\s?(?:v|в)(?![a-zа-я0-9/])/u, (match) => match[1]!);
  if (voltage && !/\d\s?\/\s?\d{1,2}\s?(?:v|в)(?![a-zа-я])/u.test(text)) specs.voltage = Number(voltage);

  if (isPart(/^ламп/u)) {
    const lamp = text.replace(/н(?=\d)/gu, "h").replace(/нв(?=\d)/gu, "hb");
    const type = only(lamp, LAMP_TYPE, (match) => match[1]!.replace(",", ".").toUpperCase());
    if (type) specs.lampType = type;
    const watts = only(lamp, /(?<![a-z0-9.,/])(\d{1,3}(?:\/\d{1,3})?)\s?w(?![a-z0-9])/u, (match) => match[1]!);
    if (watts) specs.watts = watts;
    const base = only(lamp, LAMP_BASE, (match) => match[1]!.replace(/,/gu, ".").replace(/\s/gu, "").toUpperCase());
    if (base) specs.lampBase = base;
  }
  if (isPart(/^рем(?:ен|н)/u)) {
    const ribbed = only(text, /(?<![a-z0-9])(\d{1,2})\s?pk\s?(\d{3,4})(?![0-9])/u, (match) => `${match[1]}PK${size(match[2]!)}`);
    const vee = only(text, /(?<![0-9])(10|13|17|22)\s?x\s?(\d{3,4})(?![0-9])/u, (match) => `${match[1]}X${size(match[2]!)}`);
    if (ribbed ?? vee) specs.belt = (ribbed ?? vee)!;
  }
  if (isPart(/^подшипник/u)) {
    // ISO numbers of ball (60xx–69xx, 16xxx), tapered (30xxx–33xxx) and spherical (22xxx, 23xxx) bearings; a car's
    // model («Подшипник ступицы 2101», «3302») and the older Russian numbering are left unread.
    const bearing = only(text, /(?<![0-9a-zа-я.*/-])(6\d{3}|16\d{3}|3[0-3]\d{3}|2[23]\d{3})(?:[\s-]?(2rs1?|2rsh|rs|zz|2z|z|nr))?(?![0-9a-zа-я])/u,
      (match) => (match[2] ? `${match[1]}-${match[2].toUpperCase()}` : match[1]!));
    if (bearing) specs.bearing = bearing;
  }
  if (isPart(/^сальник/u)) {
    const seal = only(text, /(?<![0-9]|\dx|\d x|\dx )(\d{1,3}(?:[.,]\d)?)\s?x\s?(\d{1,3}(?:[.,]\d)?)\s?x\s?(\d{1,2}(?:[.,]\d)?)(?![0-9]|\/\d|\s?x\s?\d)/u,
      (match) => {
        const [inner, outer, height] = [match[1]!, match[2]!, match[3]!].map(size) as [string, string, string];
        return (Number(inner) > Number(outer) ? [outer, inner, height] : [inner, outer, height]).join("X");
      });
    if (seal) specs.seal = seal;
  }
  if (has(/щ[её]тк/u) && has(/стеклоочист|с\/о|дворник|каркас|гибрид/u)) {
    const length = only(text, /(?<![0-9])([2-9]\d{2})\s?(?:мм|mm)/u, (match) => match[1]!);
    if (length) specs.lengthMm = Number(length);
  }
  if (has(/(?<![a-zа-я])акб(?![a-zа-я])|аккумулятор(?!а|у|ов|ом)/u) && !has(/заряд/u)) {
    const capacity = only(text, /(?<![0-9])(\d{2,3})\s?(?:[аa]\s?\/?\s?[чh]|ah|а·ч)(?![a-zа-я])/u, (match) => match[1]!);
    if (capacity) specs.capacityAh = Number(capacity);
    const polarity = either(tokens, ["reverse", (token) => token.startsWith("обратн")], ["direct", (token) => token.startsWith("прям")]);
    const shorthand = has(/(?<![a-zа-я])о[./]п(?![a-zа-я])/u) ? "reverse" : has(/(?<![a-zа-я])п[./]п(?![a-zа-я])/u) ? "direct" : null;
    if (polarity ?? shorthand) specs.polarity = (polarity ?? shorthand)!;
  }
  const viscosity = only(text, /(?<![0-9a-z])(0|5|10|15|20|25)\s?w\s?-?\s?(\d{2})(?![0-9])/u, (match) => `${match[1]}W-${match[2]}`);
  if (viscosity && has(/масл|oil/u)) specs.viscosity = viscosity;
  if (has(/масл|жидкост|антифриз|тосол|омыв|oil/u)) {
    const volume = only(text, /(?<![0-9.,/])(\d{1,3}(?:[.,]\d{1,3})?)\s?(?:л|l|литр[а-я]*)(?![a-zа-я])/u, (match) => String(number(match[1]!)));
    if (volume && !has(/\d\s?(?:л|l)\s?\/\s?\d/u)) specs.volumeLitres = Number(volume);
  }
  const tyre = only(text, /(?<![0-9])(\d{3})\/(\d{2})\s?z?r\s?(\d{2}(?:[.,]5)?)(?![0-9])/u, (match) => `${match[1]}/${match[2]}R${size(match[3]!)}`);
  if (tyre) specs.tyreSize = tyre;
  return specs;
}

/** Features that make two parts different parts when both know them and they differ; a volume is another pack. */
const DISTINGUISHING: ReadonlyArray<keyof PartSpecs> = [
  "side", "axle", "level", "voltage", "watts", "lampType", "lampBase", "belt", "bearing", "seal", "lengthMm", "capacityAh", "polarity", "viscosity", "tyreSize",
];

export function specsConflict(a: PartSpecs, b: PartSpecs): boolean {
  return DISTINGUISHING.some((key) => a[key] !== undefined && b[key] !== undefined && a[key] !== b[key]);
}

/** A standard size any maker's part of it fits: belt, lamp (type, voltage and base), bearing, seal, tyre; or null. */
export function partSizeKey(specs: PartSpecs): string | null {
  if (specs.belt) return `belt:${specs.belt}`;
  if (specs.lampType && specs.voltage && specs.lampBase) return `lamp:${specs.lampType}:${specs.voltage}:${specs.lampBase}`;
  if (specs.bearing) return `bearing:${specs.bearing}`;
  if (specs.seal) return `seal:${specs.seal}`;
  if (specs.tyreSize) return `tyre:${specs.tyreSize}`;
  return null;
}

/** «BA9S» is written «BA9s», «P45T-41» — «P45t-41». */
const baseAsWritten = (base: string) => base.replace(/^([A-Z]+\d+(?:\.\d)?)([A-Z])(-\d+)?$/u, (_all, head: string, letter: string, tail = "") => `${head}${letter.toLowerCase()}${tail}`);

/** The features as the product page names them, in the order a customer reads them. */
export function specLabels(specs: PartSpecs): Array<[string, string]> {
  const labels: Array<[string, string | undefined]> = [
    ["Тип лампы", specs.lampType],
    ["Напряжение", specs.voltage ? `${specs.voltage} В` : undefined],
    ["Мощность", specs.watts ? `${specs.watts} Вт` : undefined],
    ["Цоколь", specs.lampBase ? baseAsWritten(specs.lampBase) : undefined],
    ["Сторона", specs.side ? (specs.side === "left" ? "левая" : "правая") : undefined],
    ["Ось", specs.axle ? (specs.axle === "front" ? "передняя" : "задняя") : undefined],
    ["Расположение", specs.level ? (specs.level === "upper" ? "верх" : "низ") : undefined],
    ["Типоразмер ремня", specs.belt],
    ["Подшипник", specs.bearing],
    ["Размер", specs.seal ? `${specs.seal.replace(/X/gu, "×")} мм` : undefined],
    ["Длина", specs.lengthMm ? `${specs.lengthMm} мм` : undefined],
    ["Ёмкость", specs.capacityAh ? `${specs.capacityAh} А·ч` : undefined],
    ["Полярность", specs.polarity ? (specs.polarity === "reverse" ? "обратная" : "прямая") : undefined],
    ["Вязкость", specs.viscosity],
    ["Объём", specs.volumeLitres ? `${String(specs.volumeLitres).replace(".", ",")} л` : undefined],
    ["Размер шины", specs.tyreSize?.replace("R", " R")],
  ];
  return labels.filter((entry): entry is [string, string] => entry[1] !== undefined);
}

/**
 * What a database reads first when it looks for the parts of one standard size (PartsFinderShopService.sameSize):
 * names matching any of `any` and all of `all` (ILIKE patterns on the name as 1С has it, «Н7» for «H7» too). Every
 * name found is then read in full: only those of exactly the same size are offered.
 */
export function sizeSearch(key: string): { all: string[]; any: string[] } | null {
  const [kind, ...parts] = key.split(":");
  const like = (value: string) => `%${value.toLowerCase()}%`;
  if (kind === "belt") {
    const ribbed = /^(\d+)PK(\d+)$/u.exec(parts[0] ?? "");
    if (ribbed) return { all: [like(ribbed[2]!)], any: ["%pk%"] };
    const vee = /^(\d+)X(\d+)$/u.exec(parts[0] ?? "");
    return vee ? { all: [like(vee[2]!)], any: [like(vee[1]!)] } : null;
  }
  if (kind === "lamp" && parts.length === 3) {
    const type = parts[0]!.toLowerCase();
    return { all: [like(parts[1]!)], any: type.startsWith("h") ? [like(type), like(`н${type.slice(1)}`)] : [like(type)] };
  }
  if (kind === "bearing") return { all: [], any: [like(parts[0]!.split("-")[0]!)] };
  if (kind === "seal") {
    const [inner, outer] = (parts[0] ?? "").split("X");
    return inner && outer ? { all: [like(outer)], any: [like(inner)] } : null;
  }
  if (kind === "tyre") {
    const size = /^(\d{3}\/\d{2})R/u.exec(parts[0] ?? "");
    return size ? { all: [], any: [like(size[1]!)] } : null;
  }
  return null;
}

/** The standard size as the customer reads it («T4W 24 В BA9s», «4PK898», «35×50×8 мм»), or null. */
export function sizeLabel(specs: PartSpecs): string | null {
  const key = partSizeKey(specs);
  if (!key) return null;
  if (key.startsWith("lamp:")) return `${specs.lampType} ${specs.voltage} В ${baseAsWritten(specs.lampBase!)}`;
  if (key.startsWith("seal:")) return `${specs.seal!.replace(/X/gu, "×")} мм`;
  if (key.startsWith("tyre:")) return specs.tyreSize!.replace("R", " R");
  return specs.belt ?? specs.bearing ?? null;
}

const PACK_AMOUNT = /(?<![0-9.,/*])(\d{1,3}(?:[.,]\d{1,3})?)\s?(л|l|литр[а-я]*|кг|kg)(?![a-zа-я])/gu;
/** «(1/20)», «1*4»: how many packs a box holds — the owner's 1С writes it into the name; it is not a pack size. */
const PACKS_IN_BOX = /(?<![0-9a-zа-я.,/*])1\s?[/*]\s?\d{1,3}(?![0-9a-zа-я/*])/gu;

export interface ProductPack { amount: number; key: string; unit: "kg" | "l" }

/**
 * The pack a liquid is sold in, and what is left of the name without it. «9066 5W-50 Synthoil High Tech 1л» and
 * «9067 5W-50 Synthoil High Tech 4л» give one `key` and different amounts: two packs of one product. The key drops
 * the pack, the product's own article (every pack has its own) and the word order («Масло моторное» / «Моторное
 * масло»); the viscosity, the line and the approvals stay in it, so another oil is never another pack.
 * Null when the name is not a liquid's or states no single amount («4л/5л»).
 */
export function packOf(name: string, sku?: string | null): ProductPack | null {
  const text = name.toLowerCase().replaceAll("ё", "е");
  // An oil's name may not say «масло» at all: «ALPHA'S 10W40 SN (бензин, синтетика) 1л» — its viscosity says it.
  if (!/масл|жидкост|антифриз|тосол|омыв|oil|(?<![a-z0-9])\d{1,2}w-?\d{2}(?![0-9])/u.test(text) || /\d\s?(?:л|l|кг|kg)\s?\/\s?\d/u.test(text)) return null;
  const withoutBox = text.replace(PACKS_IN_BOX, " ");
  const stated = [...withoutBox.matchAll(PACK_AMOUNT)];
  if (stated.length !== 1) return null;
  const amount = Number(stated[0]![1]!.replace(",", "."));
  if (!(amount > 0)) return null;
  const article = (sku ?? "").toLowerCase().replace(/[^a-zа-я0-9]+/gu, "");
  const key = withoutBox.replace(PACK_AMOUNT, " ").split(/[^a-zа-я0-9]+/u)
    .filter((token) => token !== "" && !(article.length >= 4 && token === article)).sort().join(" ");
  return key ? { amount, key, unit: /^[кk]/u.test(stated[0]![2]!) ? "kg" : "l" } : null;
}

/** «4 л», «0,5 л», «10 кг»: a pack as the product page names it. */
export function packLabel(pack: Pick<ProductPack, "amount" | "unit">): string {
  return `${String(pack.amount).replace(".", ",")} ${pack.unit === "kg" ? "кг" : "л"}`;
}
