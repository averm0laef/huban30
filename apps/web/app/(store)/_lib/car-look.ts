/**
 * Which of our blue cars (`public/brand/fleet/<look>.webp`, Codex 25.11.2026) stands for the customer's car on «Подбор»:
 * the body type of the catalogue modification, the engine size and a few well-known model names. The picture is a
 * likeness of the kind of car, never a picture of the make — the make and model are written next to it.
 */
export const CAR_LOOKS = [
  "kei", "hatch", "sedan-compact", "sedan", "sedan-large", "wagon", "coupe", "cabrio", "crossover", "suv",
  "offroad", "minivan", "pickup", "van", "bus", "truck", "compact-van", "electric",
] as const;
export type CarLook = (typeof CAR_LOOKS)[number];

export interface CarLookInput {
  body?: string | null;
  /** «1.4 л VVT-i (ZZE120)», «2.0», «1KD-FTV 3.0 л»: the first number with a dot or comma is the size in litres. */
  engine?: string | null;
  fuel?: string | null;
  make?: string | null;
  model?: string | null;
}

/** A whole-word, case-insensitive match that also works for Cyrillic (`\\b` in JavaScript knows only Latin letters). */
function words(...names: string[]): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(${names.join("|")})(?![\\p{L}\\p{N}])`, "iu");
}

/** Model names that say more than the catalogue's body type does (a kei car is a «Хэтчбэк» there, a Probox a «универсал»). Checked in order. */
const BY_MODEL: ReadonlyArray<readonly [RegExp, CarLook]> = [
  [words("bongo ?iii", "газель", "gazelle", "canter", "elf", "mazda titan", "dyna", "toyoace", "nissan atlas", "condor", "porter", "hd ?\\d{2,3}", "валдай"), "truck"],
  [words("coaster", "civilian", "rosa", "county", "паз", "пазик"), "bus"],
  [words("n[- ]?(box|wgn|one|van)", "wagon ?r", "mira", "alto", "tanto", "move", "lapin", "spacia", "hustler", "every", "hijet", "atrai",
    "ek ?(wagon|space|x)", "dayz", "roox", "moco", "pino", "otti", "copen", "cast", "wake", "taft", "life", "zest", "vamos", "acty",
    "minicab", "carry", "scrum", "clipper", "flair", "pleo", "stella", "r1", "r2"), "kei"],
  [words("partner", "transit ?connect", "berlingo", "kangoo", "caddy", "doblo", "largus ?фургон"), "compact-van"],
  [words("hiace", "regius ?ace", "town ?ace", "lite ?ace", "caravan", "homy", "nv350", "bongo", "vanette", "delica ?van", "h-?1", "starex",
    "transit", "mercedes(-benz)? sprinter", "crafter", "ducato", "boxer", "jumper", "соболь", "sobol"), "van"],
  [words("probox", "succeed", "ad ?van", "ad", "wingroad", "fielder", "caldina", "corolla ?van"), "wagon"],
  [words("уаз", "uaz", "hunter", "patriot", "нива", "niva", "4x4", "jimny", "samurai", "land ?cruiser ?7\\d", "wrangler", "g-?class", "defender"), "offroad"],
];

function litres(engine: string | null | undefined): number | null {
  const match = /(\d{1,2})[.,](\d)/u.exec(engine ?? "");
  return match ? Number(`${match[1]}.${match[2]}`) : null;
}

export function carLook(car: CarLookInput | null | undefined): CarLook {
  if (!car) return "hatch";
  const name = `${car.make ?? ""} ${car.model ?? ""}`;
  for (const [pattern, look] of BY_MODEL) if (pattern.test(name)) return look;
  if (/электр|electric/iu.test(car.fuel ?? "")) return "electric";
  const body = (car.body ?? "").toLowerCase();
  const size = litres(car.engine);
  if (/автобус/u.test(body)) return "bus";
  if (/бортов|ходовая|тягач|коммунальн/u.test(body)) return "truck";
  if (/фургон\/(хетчбэк|хэтчбэк|универсал)/u.test(body)) return "compact-van";
  if (/фургон|микроавтобус/u.test(body)) return size !== null && size <= 1.6 ? "compact-van" : "van";
  if (/вездеход/u.test(body)) return "offroad";
  if (/пикап/u.test(body)) return "pickup";
  if (/кабриолет|тарга/u.test(body)) return "cabrio";
  if (/купе|твердым верхом/u.test(body)) return "coupe";
  if (/вэн|минивэн/u.test(body)) return size !== null && size <= 0.7 ? "kei" : "minivan";
  if (/suv|внедорожн/u.test(body)) return size !== null && size > 2.5 ? "suv" : "crossover";
  if (/универсал/u.test(body)) return "wagon";
  if (/седан/u.test(body)) return size === null ? "sedan" : size <= 1.8 ? "sedan-compact" : size > 3 ? "sedan-large" : "sedan";
  if (/хетчбэк|хэтчбэк|хэтчбек|хетчбек/u.test(body)) return size !== null && size <= 0.7 ? "kei" : "hatch";
  return "hatch";
}

/** The picture of a look, in the two densities `next/image` is not needed for (fixed size, already WebP). */
export function carLookPicture(look: CarLook): { src: string; srcSet: string } {
  return { src: `/brand/fleet/${look}@2x.webp`, srcSet: `/brand/fleet/${look}@2x.webp 1x, /brand/fleet/${look}@3x.webp 2x` };
}
