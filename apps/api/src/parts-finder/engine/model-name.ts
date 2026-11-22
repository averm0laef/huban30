/**
 * A catalogue "model" is really one generation with a technical name:
 * "Caldina Универсал (_T21_)", "Mark II IX Седан (_X11_)", "Noah/Voxy (_R6_)".
 * The picker shows it the way people speak: the model first («Caldina»),
 * then the generation (body code, years) and the body type.
 */
export interface ModelNameParts {
  /** Body type in Russian, lower case: «универсал», «седан». */
  body: string | null;
  /** The model as people call it: "Caldina", "Mark II", "Land Cruiser Prado". */
  family: string;
  /** What tells generations apart: "IX · X11", "T21", "E-RF, GF-RF". */
  generation: string | null;
}

const ROMAN = /^(?:[IVX]{1,5})$/u;
const CYRILLIC = /[А-Яа-яЁё]/u;

/** `knownFamilies`: names that contain a Roman numeral or several words ("Mark II", "Land Cruiser Prado"). */
export function parseModelName(name: string, knownFamilies: readonly string[] = []): ModelNameParts {
  const open = name.indexOf("(");
  const base = (open === -1 ? name : name.slice(0, open)).trim();
  const codes = open === -1 ? "" : name.slice(open + 1).replace(/\)\s*$/u, "");
  const tokens = base.split(/\s+/u).filter(Boolean);
  const lower = base.toLowerCase();
  const known = [...knownFamilies]
    .filter((family) => lower === family.toLowerCase() || lower.startsWith(`${family.toLowerCase()} `))
    .sort((a, b) => b.length - a.length)[0];
  let taken = known ? known.split(/\s+/u).length : 1;
  if (!known) {
    while (taken < tokens.length && !CYRILLIC.test(tokens[taken]!) && !ROMAN.test(tokens[taken]!) && tokens[taken] !== "/" && tokens[taken] !== "C") taken += 1;
  }
  const family = tokens.slice(0, taken).join(" ") || base || name;
  const rest = tokens.slice(taken);
  // Before the body type: a series or generation mark ("200", "IX"); from the first Russian word on: the body.
  const bodyAt = rest.findIndex((token) => CYRILLIC.test(token));
  const series = (bodyAt === -1 ? rest : rest.slice(0, bodyAt)).filter((token) => token !== "/");
  const bodyWords = bodyAt === -1 ? "" : rest.slice(bodyAt).join(" ");
  const bodyCode = codes.split(",").map((code) => code.replace(/_/gu, "").trim()).filter(Boolean).join(", ");
  const generation = [series.join(" "), bodyCode].filter(Boolean).join(" · ") || null;
  return { body: bodyWords ? bodyWords.toLowerCase() : null, family, generation };
}
