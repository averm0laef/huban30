/**
 * Repairs a Latin look-alike letter typed inside a Russian word («Cальник»
 * with a Latin C, «Pемень» with a Latin P): such a word reads as Russian to
 * the eye and must read so to the shop's rules.
 *
 * Only letters that look the same in both alphabets are touched, and only
 * inside a word that is otherwise Russian (at least two Russian letters, at
 * most two Latin ones), so part numbers, brand names and Latin words stay as
 * typed. The stored product name is never changed: this is for reading it.
 */
const LOOK_ALIKE: ReadonlyMap<string, string> = new Map([
  ["A", "А"], ["B", "В"], ["C", "С"], ["E", "Е"], ["H", "Н"], ["K", "К"], ["M", "М"], ["O", "О"], ["P", "Р"], ["T", "Т"], ["X", "Х"], ["Y", "У"],
  ["a", "а"], ["c", "с"], ["e", "е"], ["o", "о"], ["p", "р"], ["x", "х"], ["y", "у"],
]);

const MAX_LATIN_LETTERS = 2;
const MIN_RUSSIAN_LETTERS = 2;

export function repairMixedScript(text: string): string {
  return text.replace(/[A-Za-zА-Яа-яЁё]+/gu, (word) => {
    const latin = word.match(/[A-Za-z]/gu);
    if (!latin || latin.length > MAX_LATIN_LETTERS || word.length - latin.length < MIN_RUSSIAN_LETTERS) return word;
    if (!latin.every((letter) => LOOK_ALIKE.has(letter))) return word;
    return word.replace(/[A-Za-z]/gu, (letter) => LOOK_ALIKE.get(letter) ?? letter);
  });
}
