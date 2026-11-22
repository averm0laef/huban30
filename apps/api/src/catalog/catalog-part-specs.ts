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
