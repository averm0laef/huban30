// The maker of a part, read from the product's name.
//
// The owner's 1С base names no manufacturer, so the catalogue's brand filter stayed empty; the maker stands in the
// name itself («… SUFIX», «… | OBK KYB RK3344», «антифриз Totachi …»). This is the list of makers of PARTS — makes
// of cars are deliberately absent: «Фильтр масляный Toyota Corolla» is a filter FOR a Toyota, not by Toyota.
// A maker named by 1С itself always wins over the name (commerce-ml.parser.ts).
//
// `spellings` are lower-case and matched as whole words; `capitalsOnly` is for a maker whose name is also an
// everyday word in small letters («sat»). Measured on the owner's export of 22.11.2026 — see docs/OWN_CATALOG.md.

interface PartMaker {
  capitalsOnly?: boolean;
  name: string;
  spellings: readonly string[];
}

const MAKERS: readonly PartMaker[] = [
  { name: "LYNXauto", spellings: ["lynxauto"] },
  { name: "SAT", spellings: ["sat"], capitalsOnly: true },
  { name: "MASUMA", spellings: ["masuma"] },
  { name: "CTR", spellings: ["ctr"] },
  { name: "SUFIX", spellings: ["sufix"] },
  { name: "Ti-Guar", spellings: ["ti-guar", "tiguar"] },
  { name: "ABRO", spellings: ["abro"] },
  { name: "HOFER", spellings: ["hofer"] },
  { name: "TOTACHI", spellings: ["totachi"] },
  { name: "NOK", spellings: ["nok"] },
  { name: "SKYWAY", spellings: ["skyway"] },
  { name: "CarFort", spellings: ["carfort"] },
  { name: "TORSO", spellings: ["torso"] },
  { name: "SHEFT", spellings: ["sheft"] },
  { name: "MILES", spellings: ["miles"] },
  { name: "STELLOX", spellings: ["stellox"] },
  { name: "FILTRON", spellings: ["filtron"] },
  { name: "OBK", spellings: ["obk"] },
  { name: "KIXX", spellings: ["kixx"] },
  { name: "SAKURA", spellings: ["sakura"] },
  { name: "Gazpromneft", spellings: ["gazpromneft", "газпромнефть"] },
  { name: "KOYO", spellings: ["koyo"] },
  { name: "MARUICHI", spellings: ["maruichi"] },
  { name: "IHOYEI", spellings: ["ihoyei"] },
  { name: "JFBK", spellings: ["jfbk"] },
  { name: "AutoProfi", spellings: ["autoprofi"] },
  { name: "Madfil", spellings: ["madfil"] },
  { name: "MANN-FILTER", spellings: ["mann-filter", "mann filter", "mann"] },
  { name: "BOSCH", spellings: ["bosch"] },
  { name: "NGK", spellings: ["ngk"] },
  { name: "DENSO", spellings: ["denso"] },
  { name: "MAHLE", spellings: ["mahle"] },
  { name: "SACHS", spellings: ["sachs"] },
  { name: "BREMBO", spellings: ["brembo"] },
  { name: "KYB", spellings: ["kyb", "kayaba"] },
  { name: "FEBEST", spellings: ["febest"] },
  { name: "FEBI", spellings: ["febi"] },
  { name: "TRW", spellings: ["trw"] },
  { name: "LEMFORDER", spellings: ["lemforder", "lemförder"] },
  { name: "Лукойл", spellings: ["lukoil", "лукойл"] },
  { name: "Castrol", spellings: ["castrol"] },
  { name: "Mobil", spellings: ["mobil"] },
  { name: "Shell", spellings: ["shell"] },
  { name: "LIQUI MOLY", spellings: ["liqui moly", "liquimoly", "liqui-moly"] },
  { name: "Motul", spellings: ["motul"] },
  { name: "VARTA", spellings: ["varta"] },
  { name: "PHILIPS", spellings: ["philips"] },
  { name: "OSRAM", spellings: ["osram"] },
  { name: "VALEO", spellings: ["valeo"] },
  { name: "CHAMPION", spellings: ["champion"] },
  { name: "FELIX", spellings: ["felix"] },
  { name: "SINTEC", spellings: ["sintec", "синтек"] },
  { name: "ContiTech", spellings: ["contitech"] },
  { name: "GATES", spellings: ["gates"] },
  { name: "HELLA", spellings: ["hella"] },
  { name: "MEYLE", spellings: ["meyle"] },
  { name: "ELRING", spellings: ["elring"] },
];

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * The maker whose name stands in the product's name as a whole word; the first one when several do. What stands in
 * brackets is left out: «(CTR CBHO-44)», «(Sakura C-1541)» name the number of an analogue, not who made the part —
 * and no brand is better than a wrong one.
 */
export function partMakerInName(source: string): string | null {
  // Brackets are blanked, not cut, so that the places of the other words do not move.
  const name = source.replace(/\([^()]*\)/gu, (bracketed) => " ".repeat(bracketed.length));
  const lower = name.toLowerCase();
  let found: { at: number; name: string } | null = null;
  for (const maker of MAKERS) {
    for (const spelling of maker.spellings) {
      for (let at = lower.indexOf(spelling); at >= 0; at = lower.indexOf(spelling, at + 1)) {
        const whole = !LETTER_OR_DIGIT.test(name[at - 1] ?? "") && !LETTER_OR_DIGIT.test(name[at + spelling.length] ?? "");
        const cased = !maker.capitalsOnly || name.slice(at, at + spelling.length) === spelling.toUpperCase();
        if (whole && cased) {
          if (!found || at < found.at) found = { at, name: maker.name };
          break;
        }
      }
    }
  }
  return found?.name ?? null;
}
