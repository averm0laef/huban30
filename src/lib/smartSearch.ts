/**
 * Smart search utilities for auto parts store.
 * Handles transliteration (RU↔EN), keyboard layout swap, brand aliases,
 * SKU normalization, typo tolerance (Levenshtein), and scored ranking.
 */

// ─── Keyboard layout swap ───────────────────────────────────────────────────

const ruToEnMap: Record<string, string> = {
  'й': 'q', 'ц': 'w', 'у': 'e', 'к': 'r', 'е': 't', 'н': 'y', 'г': 'u', 'ш': 'i',
  'щ': 'o', 'з': 'p', 'х': '[', 'ъ': ']', 'ф': 'a', 'ы': 's', 'в': 'd', 'а': 'f',
  'п': 'g', 'р': 'h', 'о': 'j', 'л': 'k', 'д': 'l', 'ж': ';', 'э': "'", 'я': 'z',
  'ч': 'x', 'с': 'c', 'м': 'v', 'и': 'b', 'т': 'n', 'ь': 'm', 'б': ',', 'ю': '.',
};

const enToRuMap: Record<string, string> = Object.fromEntries(
  Object.entries(ruToEnMap).map(([ru, en]) => [en, ru])
);

function swapKeyboardLayout(text: string): string {
  const isRussian = /[а-яё]/i.test(text);
  const map = isRussian ? ruToEnMap : enToRuMap;
  return text
    .split('')
    .map(ch => {
      const lower = ch.toLowerCase();
      const mapped = map[lower];
      if (!mapped) return ch;
      return ch === lower ? mapped : mapped.toUpperCase();
    })
    .join('');
}

// ─── Transliteration RU → EN ────────────────────────────────────────────────

const translitMap: Record<string, string> = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
  'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
  'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
  'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
  'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
};

function transliterateRuToEn(text: string): string {
  return text
    .split('')
    .map(ch => {
      const lower = ch.toLowerCase();
      const mapped = translitMap[lower];
      if (mapped === undefined) return ch;
      return ch === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1);
    })
    .join('');
}

// ─── SKU / Article number normalization ─────────────────────────────────────

/** Strip dashes, dots, spaces from an article string for fuzzy SKU comparison */
export function normalizeSku(sku: string): string {
  return sku.replace(/[\s\-._/\\()]/g, '').toLowerCase();
}

/** Check if query looks like an article/part number (has digits + optional letters) */
export function looksLikeArticle(query: string): boolean {
  const cleaned = query.replace(/[\s\-._/\\()]/g, '');
  // At least 3 chars, contains digits
  return cleaned.length >= 3 && /\d/.test(cleaned) && /^[a-zA-Zа-яА-ЯёЁ0-9]+$/.test(cleaned);
}

// ─── Levenshtein distance for typo tolerance ────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Optimization: skip if lengths differ too much
  if (Math.abs(m - n) > 3) return Math.max(m, n);

  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** Returns true if words are close enough (1-2 typos depending on length) */
function isFuzzyMatch(query: string, target: string): boolean {
  const maxDist = query.length <= 4 ? 1 : 2;
  return levenshtein(query, target) <= maxDist;
}

// ─── Brand & part aliases ───────────────────────────────────────────────────

const brandAliases: Record<string, string[]> = {
  // Car brands
  'lada': ['лада', 'ваз', 'vaz', 'жигули', 'zhiguli', 'автоваз', 'avtovaz', 'приора', 'priora', 'гранта', 'granta', 'калина', 'kalina', 'веста', 'vesta', 'нива', 'niva'],
  'toyota': ['тойота', 'тоёта', 'тоета'],
  'hyundai': ['хёндай', 'хендай', 'хендэ', 'хюндай', 'хундай', 'солярис', 'solaris', 'крета', 'creta'],
  'kia': ['киа', 'кия'],
  'nissan': ['ниссан', 'нисан'],
  'honda': ['хонда'],
  'mazda': ['мазда'],
  'mitsubishi': ['мицубиси', 'митсубиси', 'митсубиши', 'мицубиши'],
  'subaru': ['субару'],
  'suzuki': ['сузуки'],
  'ford': ['форд'],
  'chevrolet': ['шевроле', 'шеви', 'chevy', 'шевролет'],
  'volkswagen': ['фольксваген', 'фольцваген', 'vw', 'фв'],
  'bmw': ['бмв', 'бэмвэ', 'бэха'],
  'mercedes': ['мерседес', 'мерс', 'мб', 'mb', 'mercedes-benz'],
  'audi': ['ауди'],
  'skoda': ['шкода', 'škoda'],
  'renault': ['рено', 'ренаулт'],
  'peugeot': ['пежо'],
  'citroen': ['ситроен', 'citroën'],
  'opel': ['опель'],
  'volvo': ['вольво'],
  'daewoo': ['дэу', 'деу', 'дэву'],
  'geely': ['джили', 'гили'],
  'chery': ['чери', 'черри'],
  'haval': ['хавал', 'хавейл'],
  'gaz': ['газ', 'газель', 'gazel', 'газон', 'соболь'],
  'uaz': ['уаз', 'патриот', 'patriot', 'хантер', 'hunter', 'буханка'],
  'kamaz': ['камаз'],
  'daihatsu': ['дайхатсу', 'дайхацу'],
  'isuzu': ['исузу', 'исудзу'],
  'lexus': ['лексус'],
  'infiniti': ['инфинити'],
  'ssangyong': ['санг йонг', 'ссанг йонг', 'ссангйонг'],
  'changan': ['чанган'],
  'faw': ['фав'],
  'lifan': ['лифан'],
  'byd': ['бид', 'бюд'],
  'great wall': ['грейт вол', 'грейтвол'],
  'dongfeng': ['донгфенг', 'донфенг'],

  // Part brands
  'bosch': ['бош'],
  'denso': ['денсо'],
  'ngk': ['нгк'],
  'mann': ['манн', 'mann-filter'],
  'mahle': ['маль', 'мале'],
  'sachs': ['сакс', 'закс'],
  'lemforder': ['лемфёрдер', 'лемфордер'],
  'trw': ['трв'],
  'ate': ['ате', 'атэ'],
  'brembo': ['брембо'],
  'febi': ['феби', 'febi bilstein'],
  'gates': ['гейтс'],
  'dayco': ['дайко'],
  'continental': ['континенталь'],
  'skf': ['скф'],
  'ina': ['ина'],
  'fag': ['фаг'],
  'kyb': ['кайаба', 'kayaba'],
  'monroe': ['монро'],
  'bilstein': ['бильштайн'],
  'hella': ['хелла'],
  'valeo': ['валео'],
  'luk': ['лук'],
  'wahler': ['валер'],
  'filtron': ['фильтрон'],
  'hofer': ['хофер'],
  'lynxauto': ['линкс', 'lynx'],
  'kraft': ['крафт'],
  'stellox': ['стеллокс'],
  'fenox': ['фенокс'],
  'masuma': ['масума'],
  'sat': ['сат'],

  // Part type aliases (expanded)
  'колодки': ['тормозные колодки', 'brake pads', 'pad', 'колодка'],
  'фильтр': ['filter', 'фильтра', 'фильтры'],
  'фильтр масляный': ['масляный фильтр', 'oil filter'],
  'фильтр воздушный': ['воздушный фильтр', 'air filter'],
  'фильтр салонный': ['салонный фильтр', 'cabin filter'],
  'фильтр топливный': ['топливный фильтр', 'fuel filter'],
  'свечи': ['свечи зажигания', 'spark plug', 'свеча', 'свечки'],
  'ремень': ['ремень грм', 'timing belt', 'belt', 'ремень генератора', 'ремень привода'],
  'амортизатор': ['стойка', 'shock', 'absorber', 'амортизаторы', 'стойки'],
  'диск': ['тормозной диск', 'brake disc', 'rotor', 'диски'],
  'подшипник': ['bearing', 'подшипники'],
  'термостат': ['thermostat'],
  'радиатор': ['radiator', 'радиаторы'],
  'генератор': ['alternator', 'генераторы'],
  'стартер': ['starter', 'стартеры'],
  'помпа': ['водяной насос', 'water pump', 'pump', 'насос'],
  'сцепление': ['clutch', 'корзина сцепления', 'диск сцепления'],
  'рулевая': ['рулевая рейка', 'steering rack', 'steering', 'рулевая тяга', 'рулевой наконечник'],
  'масло': ['масло моторное', 'oil', 'моторное масло', 'engine oil', 'масло трансмиссионное'],
  'антифриз': ['охлаждающая жидкость', 'coolant', 'тосол', 'tosol'],
  'аккумулятор': ['акб', 'battery', 'батарея'],
  'лампа': ['лампочка', 'bulb', 'лампы', 'lamp'],
  'провода': ['провод', 'высоковольтные провода', 'вв провода', 'ignition wire'],
  'шаровая': ['шаровая опора', 'ball joint'],
  'сайлентблок': ['сайлент', 'silent block', 'сайлентблоки'],
  'втулка': ['bushing', 'втулки'],
  'пыльник': ['boot', 'пыльники', 'чехол'],
  'крестовина': ['universal joint', 'кардан'],
  'тяга': ['тяги', 'tie rod'],
  'датчик': ['sensor', 'датчики'],
  'реле': ['relay'],
  'предохранитель': ['fuse', 'предохранители'],
  'прокладка': ['gasket', 'прокладки'],
  'сальник': ['seal', 'oil seal', 'сальники'],
  'ступица': ['hub', 'ступичный подшипник'],
  'шрус': ['граната', 'cv joint', 'шрус наружный', 'шрус внутренний', 'привод'],
  'глушитель': ['muffler', 'exhaust', 'выхлоп'],
  'бензонасос': ['топливный насос', 'fuel pump'],
  'форсунка': ['injector', 'форсунки'],
  'катушка': ['катушка зажигания', 'ignition coil', 'coil'],
  'тросик': ['трос', 'cable', 'тросик сцепления', 'тросик газа'],
};

// Build reverse map for fast lookup
const aliasToCanonical: Map<string, string[]> = new Map();

function initAliasMap() {
  if (aliasToCanonical.size > 0) return;
  for (const [canonical, aliases] of Object.entries(brandAliases)) {
    const allForms = [canonical, ...aliases];
    for (const form of allForms) {
      const existing = aliasToCanonical.get(form.toLowerCase()) || [];
      aliasToCanonical.set(form.toLowerCase(), [...new Set([...existing, ...allForms])]);
    }
  }
}

// ─── Model numbers (e.g. 2101, 2108, 2110) ─────────────────────────────────

const modelNumbers: Record<string, string[]> = {
  '2101': ['ваз 2101', 'классика', 'копейка', 'жигули'],
  '2103': ['ваз 2103', 'тройка'],
  '2105': ['ваз 2105', 'пятерка', 'пятёрка'],
  '2106': ['ваз 2106', 'шестерка', 'шестёрка', 'шаха'],
  '2107': ['ваз 2107', 'семерка', 'семёрка'],
  '2108': ['ваз 2108', 'восьмерка', 'восьмёрка', 'зубило'],
  '2109': ['ваз 2109', 'девятка', 'девяточка'],
  '2110': ['ваз 2110', 'десятка', 'десяточка'],
  '2111': ['ваз 2111'],
  '2112': ['ваз 2112', 'двенашка', 'двенадцатая'],
  '2114': ['ваз 2114', 'четырка', 'четырнадцатая'],
  '2115': ['ваз 2115', 'пятнашка', 'пятнадцатая'],
  '2170': ['приора', 'priora'],
  '2190': ['гранта', 'granta'],
  '1118': ['калина', 'kalina'],
  '2180': ['веста', 'vesta'],
  '2121': ['нива', 'niva'],
  '3110': ['волга', 'volga', 'газ 3110'],
  '31105': ['волга', 'газ 31105'],
  '3302': ['газель', 'gazel', 'газ 3302'],
  '53': ['газ 53'],
  '66': ['газ 66', 'шишига'],
  '469': ['уаз 469'],
  '452': ['уаз 452', 'буханка'],
  '3163': ['уаз патриот', 'patriot'],
};

// ─── Query expansion ────────────────────────────────────────────────────────

/**
 * Expand a search query into multiple alternative queries for broader matching.
 * Returns an array of lowercase query variants.
 */
export function expandSearchQuery(query: string): string[] {
  initAliasMap();
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const variants = new Set<string>();
  variants.add(q);

  // Add keyboard layout swap
  const swapped = swapKeyboardLayout(q).toLowerCase();
  if (swapped !== q) variants.add(swapped);

  // Add transliteration
  const translit = transliterateRuToEn(q).toLowerCase();
  if (translit !== q) variants.add(translit);

  // Add normalized SKU variant (no dashes/spaces)
  const normalized = normalizeSku(q);
  if (normalized !== q && normalized.length >= 3) variants.add(normalized);

  // Split into words and expand each via aliases
  const words = q.split(/\s+/);
  for (const word of words) {
    const synonyms = aliasToCanonical.get(word);
    if (synonyms) {
      for (const syn of synonyms) {
        const variant = words.map(w => w === word ? syn : w).join(' ');
        variants.add(variant);
      }
    }
    // Also check model numbers
    const modelMatches = modelNumbers[word];
    if (modelMatches) {
      for (const m of modelMatches) {
        const variant = words.map(w => w === word ? m : w).join(' ');
        variants.add(variant);
      }
    }
  }

  // Check full query against aliases
  const fullMatch = aliasToCanonical.get(q);
  if (fullMatch) {
    for (const syn of fullMatch) {
      variants.add(syn);
    }
  }

  // Check full query against model numbers
  const modelMatch = modelNumbers[q];
  if (modelMatch) {
    for (const m of modelMatch) {
      variants.add(m);
    }
  }

  return Array.from(variants);
}

// ─── Scoring and matching ───────────────────────────────────────────────────

interface SearchableFields {
  title?: string;
  sku?: string;
  brand?: string;
  description?: string;
  display_title?: string;
}

/**
 * Score a product against a query (higher = better match).
 * Returns 0 for no match, positive number for matches.
 */
export function scoreMatch(query: string, fields: SearchableFields): number {
  if (!query.trim()) return 1;

  const q = query.trim().toLowerCase();
  const variants = expandSearchQuery(q);
  const title = (fields.display_title || fields.title || '').toLowerCase();
  const sku = (fields.sku || '').toLowerCase();
  const brand = (fields.brand || '').toLowerCase();
  const description = (fields.description || '').toLowerCase();
  const normalizedSku = normalizeSku(sku);

  let bestScore = 0;

  // Check if query looks like article number → prioritize SKU match
  if (looksLikeArticle(q)) {
    const normalizedQuery = normalizeSku(q);
    if (normalizedSku === normalizedQuery) return 1000; // Exact SKU match
    if (normalizedSku.includes(normalizedQuery)) return 800;
    if (normalizedQuery.includes(normalizedSku) && normalizedSku.length > 3) return 600;
    // Also check title for the article
    if (title.includes(normalizedQuery) || title.includes(q)) return 400;
  }

  for (const variant of variants) {
    const words = variant.split(/\s+/).filter(Boolean);
    const searchableText = `${title} ${sku} ${brand} ${description}`;

    // Exact full match in title
    if (title.includes(variant)) {
      bestScore = Math.max(bestScore, 500);
      continue;
    }

    // All words match
    const allWordsMatch = words.every(w => searchableText.includes(w));
    if (allWordsMatch) {
      // Boost if match is in title specifically
      const inTitle = words.every(w => title.includes(w));
      bestScore = Math.max(bestScore, inTitle ? 300 : 200);
      continue;
    }

    // Partial word match (at least half the words match)
    const matchingWords = words.filter(w => searchableText.includes(w));
    if (matchingWords.length > 0 && matchingWords.length >= words.length * 0.5) {
      bestScore = Math.max(bestScore, 50 + matchingWords.length * 20);
      continue;
    }

    // Fuzzy match individual words (typo tolerance)
    if (words.length === 1 && words[0].length >= 4) {
      const titleWords = title.split(/[\s\-_/|,]+/).filter(w => w.length >= 3);
      for (const tw of titleWords) {
        if (isFuzzyMatch(words[0], tw)) {
          bestScore = Math.max(bestScore, 100);
          break;
        }
      }
    }
  }

  return bestScore;
}

/**
 * Check if a product matches the search query using smart matching.
 * Backward-compatible wrapper around scoreMatch.
 */
export function smartMatch(
  query: string,
  fields: { title?: string; sku?: string; brand?: string; description?: string }
): boolean {
  return scoreMatch(query, fields) > 0;
}

/**
 * Build an `or` filter string for Supabase ilike queries.
 * Returns multiple search terms to OR together.
 */
export function buildSupabaseSearchTerms(query: string): string[] {
  const variants = expandSearchQuery(query);
  // Also add normalized SKU if it looks like article
  if (looksLikeArticle(query)) {
    const norm = normalizeSku(query);
    if (!variants.includes(norm)) variants.push(norm);
  }
  // Limit to avoid query explosion
  return variants.slice(0, 8);
}
