// The name of a product as a customer sees it.
//
// The owner's staff type notes for themselves into product names in 1С: «(Ш)», «+++», the number of the shelf box
// a part lies in, «АУДИТ 2023». Measured on the owner's base (22.11.2026), about 1 700 names of 42 723 carry one.
// The stored name is never changed — the staff need their notes, and the search still finds «коробка 9» — the
// notes are only left out of what the storefront shows.
//
// Only what is beyond doubt a note is removed. Marks whose meaning only the owner knows («*» after a brand,
// «АКЦИЯ») and facts about the product («В РОЗЛИВ», «ЦЕНА ЗА ШТУКУ», «Б/У», a part number in brackets) stay.
//
// One more kind of noise goes with the notes: 80 names of that base carry the quoting of a CSV price list that was
// loaded into 1С — «"Щетка ""AIDO"" 600 ММ (24"")"», the whole name in quotes and the quotes inside doubled.

import { normalizeArticleNumber } from "./catalog-search-normalize.js";

/** «(Ш)» standing on its own inside a name. Glued to a word there it is a thread designation: «BSP(Ш)3/8». */
const STANDALONE_SH = /(\s)\([Шш]\)(?=\s|$)/gu;
/** «(Ш) Заклепка», «(Ш)Топливный насос»: at the very start it is a note, with a space after it or without. */
const LEADING_SH = /^\s*\([Шш]\)\s*/u;
/** «КОРОБКА 8», «коробка 2/1», «(Коробка 2)»: where the part lies. «(коробка 100шт)» is how it is packed. */
const SHELF_BOX = /\s*\(?(?<![a-zа-яё])коробка\s*\d+(?!\d)(?:\/\d+(?!\d))?\)?(?!\s*(?:шт|конт|с\s))/giu;
/** «АУДИТ», «АУДИТ 2023», «АУДИТ 17.07.2025», «АУДИТ ПРОДАТЬ». */
const AUDIT_NOTE = /\s*(?<![a-zа-яё])аудит(?:\s+продать)?(?:\s+\d{2}\.\d{2}\.\d{4}|\s+\d{4})?(?![a-zа-яё0-9])/giu;
/** «+++ Клипса», «+ (SAMPA 095.568) Ремкомплект», «+++САЙЛЕНТБЛОК»: with a space after them or without. */
const LEADING_PLUSES = /^\s*\++\s*/u;
/** «(15) В РОЗЛИВ Масло»: a number of one or two digits. Five digits and more are the part's own number. */
const LEADING_SMALL_NUMBER = /^\s*\(\d{1,2}\)\s*/u;
/** «---Ароматизатор», «----- домкрат»: a mark like the pluses. One dash is the name's own: «-40 Тосол». */
const LEADING_DASHES = /^\s*-{2,}\s*/u;

/**
 * `text` without the quoting of a CSV field: the quote that opens the field and the one that closes it (either may
 * be missing — names are cut off at a length), and every doubled quote read as one. A name that has no doubled
 * quote is touched only when the whole of it is in quotes; quotes around a trade name inside it are its own.
 */
function withoutCsvQuoting(text: string): string {
  if (!text.includes('""')) {
    const whole = text.length > 2 && text.startsWith('"') && text.endsWith('"') && !text.slice(1, -1).includes('"');
    return whole ? text.slice(1, -1) : text;
  }
  // An odd run of quotes at an end is a wrapping quote followed by doubled ones.
  let field = (/^"+/u.exec(text)?.[0].length ?? 0) % 2 === 1 ? text.slice(1) : text;
  if ((/"+$/u.exec(field)?.[0].length ?? 0) % 2 === 1) field = field.slice(0, -1);
  // Inside a CSV field every quote is doubled. When one is not, the quotes at the ends were the name's own.
  const quotedField = (field.match(/"+/gu) ?? []).every((run) => run.length % 2 === 0);
  return (quotedField ? field : text).replace(/"{2,}/gu, '"');
}

/** Shorthands 1С names start with in small letters (the owner's base, 23.11.2026): written in capitals. */
const SHORTHAND_CAPITALS: ReadonlyMap<string, string> = new Map([
  ["акб", "АКБ"], ["шрус", "ШРУС"], ["грм", "ГРМ"], ["гур", "ГУР"], ["кпп", "КПП"], ["акпп", "АКПП"], ["мкпп", "МКПП"],
  ["рвд", "РВД"], ["тнвд", "ТНВД"], ["гпс", "ГПС"],
]);

/**
 * `shown` read with the product's article, which the page shows on a line of its own: without the article it starts
 * with (5 780 names of the owner's base) when a word is left after it, without the article said twice at its end,
 * and with a capital letter when 1С has it in small letters («лента изоляционная …», «акб BARS …»). A Latin word in
 * small letters at the start is a brand or a code and is left as typed.
 */
function readWithArticle(shown: string, sku: string): string {
  const article = sku.trim();
  let name = shown;
  const rest = name.slice(article.length);
  if (article && name.slice(0, article.length).toLowerCase() === article.toLowerCase() && /^\s/u.test(rest) && /[a-zа-яё]{3,}/iu.test(rest)) {
    name = rest.trim();
  }
  const words = name.split(" ");
  const last = words.at(-1) ?? "";
  if (words.length > 2 && last === words.at(-2) && /\d/u.test(last) && normalizeArticleNumber(last) === normalizeArticleNumber(article)) words.pop();
  name = words.join(" ");
  const first = /^[а-яё][а-яё/]*/u.exec(name)?.[0];
  if (!first) return name;
  return (SHORTHAND_CAPITALS.get(first) ?? first[0]!.toUpperCase() + first.slice(1)) + name.slice(first.length);
}

/**
 * `name` without the staff's notes and CSV quoting; `name` itself when nothing would be left. With the product's
 * `sku` it is also read with the article (readWithArticle) — that is what the storefront shows. The exchange stores
 * the name without `sku`: the page address and the search are derived from the stored name.
 */
export function publicProductName(name: string, sku?: string | null): string {
  let shown = name.replace(STANDALONE_SH, "$1").replace(SHELF_BOX, " ").replace(AUDIT_NOTE, " ");
  // A note may stand before the quoted name or inside the quotes: repeat until nothing more comes off.
  for (let previous = ""; previous !== shown;) {
    previous = shown;
    shown = shown.replace(LEADING_SH, "").replace(LEADING_PLUSES, "").replace(LEADING_DASHES, "").replace(LEADING_SMALL_NUMBER, "");
    shown = withoutCsvQuoting(shown.replace(/\s+/gu, " ").trim());
  }
  if (shown.length === 0) return name;
  return sku ? readWithArticle(shown, sku) : shown;
}
