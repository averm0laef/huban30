// The words a product's name is read by but is not written with, for the search.
//
// The catalogue search compares a query with the name as it is typed in 1С, and names are typed with shorthand
// («аром-р», «предохр.», «п/син», «к-т»), misprints and Latin letters that look like Russian ones («Cальник»,
// «Pемень»): in the owner's base 1 893 names of 42 723 could not be found by the proper word. The part dictionary
// already reads such names for sorting products into sections (expandAbbreviations); here the same reading gives
// the search the words that are missing from the name as typed. The name shown to the customer is not changed.

import { expandAbbreviations } from "./catalog-part-dictionary.js";
import { lightRussianStem } from "./catalog-search-tokens.js";

const MAX_WORDS = 12;
const MAX_SEARCH_TEXT = 10_000;
/** Words nobody searches by: «д/окон» reads as «для окон»; «бренд:», «cтрана:» are labels typed into a name. */
const SKIPPED_WORDS: ReadonlySet<string> = new Set(["для", "под", "над", "при", "без", "или", "страна", "бренд", "артикул"]);

function fold(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/ё/gu, "е");
}

/**
 * Russian words the name reads as that the search would not find in `written` (the text the product is already
 * searched by; the name itself by default). A word whose stem is already there is left out: the search looks for
 * stems, so «маслянный» is found by «масляный» as it is.
 */
export function searchReadingWords(name: string, written: string = name): string[] {
  const text = fold(written);
  const words: string[] = [];
  // A trade mark sign is not a letter: left in, «МАЯКАВТО™» would be read as the word «маякавтотм».
  for (const word of expandAbbreviations(name.replace(/[™®©]/gu, " ")).split(/[^a-zа-я0-9]+/u)) {
    if (!/^[а-я]{3,}$/u.test(word) || SKIPPED_WORDS.has(word) || words.includes(word)) continue;
    // Written already — as the word itself (the stem of «сайлентблок» drops its vowel and is not in the word as
    // written) or as its stem («маслянный» holds the stem of «масляный»).
    const stem = lightRussianStem(word);
    if (text.includes(word) || (stem !== null && text.includes(stem))) continue;
    words.push(word);
    if (words.length === MAX_WORDS) break;
  }
  return words;
}

/**
 * The text a product from 1С is searched by: its article, its name as typed, whatever else the exchange knows
 * about it (the cars it fits), and the words its name is read by.
 */
export function productSearchText(sku: string, name: string, extra: readonly string[] = []): string {
  const written = [sku, name, ...extra].join(" ");
  return [written, ...searchReadingWords(name, written)].join(" ").slice(0, MAX_SEARCH_TEXT);
}
