/**
 * The names of the owner's 1С groups, read without his numbering and notes.
 *
 * The groups of the base are numbered by hand («01.04 Ф/маслянный», «02.21.01
 * Ступица подшип», «01.14. Шаровая опора») and carry notes about the stock
 * («… 2023», «… ОТОШЛО», «… (Ш)», «ВТУЛКИ 1 КОРОБКА»). None of that says what
 * the group holds, so it is taken off before the name is read.
 *
 * Some groups hold the workshop's price list, not goods («Шиномонтажа», «СТО»,
 * «Услуги доставки»): such a group, and everything under it, gives a product
 * no section. Staff send these groups to the hidden shelf.
 */

/** «01.04 », «02.21.01 », «01.14. », «11. », «02 », «01.2025 »: the numbering in front of a name. */
const LEADING_NUMBER = /^\s*\d{1,2}(?:\.\d{1,4})*\.?\s+(?=\S)/u;
/** A year the owner marks a group with: «САЙЛЕНТБЛОК 2022», «САЛЬНИК 2026». */
const YEAR_NOTE = /(?<![\d.])20[2-3]\d(?![\d.])/gu;
/** «ОТОШЛО» (sold out), «(Ш)» (bar-coded), «1 КОРОБКА» (where it is kept). */
const STOCK_NOTES = /(?<![a-zа-яё0-9])отошло(?![a-zа-яё0-9])|\(ш\)|(?<![a-zа-яё0-9])\d+\s+коробк[а-яё]*/giu;

/** The group's name without the numbering in front and the notes behind. */
export function cleanGroupName(name: string): string {
  return name.replace(LEADING_NUMBER, "").replace(YEAR_NOTE, " ").replace(STOCK_NOTES, " ").replace(/\s+/gu, " ").trim();
}

/** First words of groups that hold work, not goods. «Ремонтные комплекты» start with another word and are goods. */
const SERVICE_FIRST_WORDS: ReadonlySet<string> = new Set(["сто", "ремонт", "изготовление"]);
const SERVICE_FIRST_WORD_STARTS: readonly string[] = ["шиномонтаж", "услуг"];

/** True for a group that holds the workshop's price list: «Шиномонтажа», «СТО», «Услуги доставки», «Ремонт грузовой». */
export function isServiceGroupName(name: string): boolean {
  const first = cleanGroupName(name).toLowerCase().split(/[^a-zа-яё0-9]+/u).find(Boolean) ?? "";
  return SERVICE_FIRST_WORDS.has(first) || SERVICE_FIRST_WORD_STARTS.some((start) => first.startsWith(start));
}
