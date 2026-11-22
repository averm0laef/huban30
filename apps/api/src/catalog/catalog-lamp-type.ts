/**
 * What a lamp's marking says about the lamp, when its name has no word for
 * the kind.
 *
 * Bulbs are sold by their marking: «D2R», «H27W/1», «R10W BA15S», «21/5W»,
 * «SV8.5». The storefront has four lamp shelves — xenon, LED, halogen, and
 * «signal and side lights», which also takes the small bulbs of dashboards
 * and interiors. Names in the owner's base often type the Russian «Н» for
 * the Latin «H» («Лампа Н13»), so both are read.
 *
 * Asked only when no word of the name picked a shelf (catalog-known-
 * categories.ts); a name that says nothing («Лампа в ассорт») stays in the
 * section.
 */

const XENON = "ksenonovye-lampy";
const LED = "svetodiodnye-lampy";
const HALOGEN = "galogennye-lampy";
const SIGNAL = "signalnye-lampy";

/** «D1S» … «D4R»: gas-discharge burners. */
const XENON_MARKING = /(?<![a-z0-9])d[1-8][sr](?![a-z0-9])/u;
/** «4 диода», «13SMD», «COB», «LED». */
const LED_WORDS = /диод|smd|(?<![a-z])cob(?![a-z])|(?<![a-z])led(?![a-z])/u;
/**
 * Headlight and fog lamps: «H1» … «H16» (never «H21W», a signal bulb), «H27W», «HB3», «9005», «R2» with its
 * «P45t» base, and the trade word «фарная».
 */
const HALOGEN_MARKING = /(?<![a-z0-9])h(?:1|2|3|4|7|8|9|10|11|13|15|16)(?![a-z0-9])|(?<![a-z0-9])h27w|(?<![a-z0-9])hb[1-5](?![a-z0-9])|(?<![a-z0-9])900[5-7](?![0-9])|(?<![a-z0-9])r2(?![a-z0-9])|p45t|фарн/u;
/** «W5W», «PY21W», «R10W», «T4W», «H21W», «C10W», «W2.3W»: a letter, the watts, «W». */
const SIGNAL_MARKING = /(?<![a-z0-9])(?:wy?|py?|r|t|h|c)\d{1,2}(?:[.,]\d)?(?:\/\d{1,2})?w(?![a-z0-9])/u;
/** Named by power or by the place it lights: «21/5W», «21W», «стоп-сигнал», «панели приборов», «салона». */
const SIGNAL_WORDS = /(?<![0-9])21(?:\/5)?\s?w(?![a-z0-9])|стоп|поворот|габарит|панел|прибор|салон|щиток|подсветк/u;
/** Named by the base alone: «б/ц», «безцокольная», «малый цоколь», «BA15S», «BAY9S», «SV8.5», «(2,1 х 9,5D)». */
const SMALL_BASE = /б\/ц|бе[зс]цокол|без цокол|цокол|(?<![a-z0-9])ba[xy]?\d|(?<![a-z0-9])sv\d|2[.,]1\s*[xх]\s*9[.,]5/u;

/** One of the four lamp shelves, or null when the name carries no marking this module knows. */
export function lampKind(name: string): string | null {
  // «Н13», «НВ4» typed in Russian letters are «H13», «HB4».
  const text = name.toLowerCase().replace(/ё/gu, "е").replace(/нв(?=\d)/gu, "hb").replace(/н(?=\d)/gu, "h");
  if (XENON_MARKING.test(text)) return XENON;
  if (LED_WORDS.test(text)) return LED;
  if (HALOGEN_MARKING.test(text)) return HALOGEN;
  if (SIGNAL_MARKING.test(text) || SIGNAL_WORDS.test(text) || SMALL_BASE.test(text)) return SIGNAL;
  return null;
}
