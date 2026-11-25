/**
 * The parts catalogue of one car from UMAPI (docs/UMAPI_INTEGRATION.md, «Каталог запчастей по машине»): its
 * sections, the part types of a section, the parts of a type. Pure rules; the service asks UMAPI with what they give.
 *
 * What UMAPI names a section or a part type the way a parts catalogue does («Фильтр, воздух во внутренном
 * пространстве») is shown as customers say it («Фильтр салона»); the catalogue's own name stays in `original`.
 */
import type { UmapiMedia } from "./umapi-normalize.js";

export interface CarCategory { children: CarCategory[]; id: number; name: string }
/** UMAPI's quick sections («quic»): a dozen and a half groups over the tree, each naming its categories. */
export interface CarGroup { categoryIds: number[]; hint: string; id: number; name: string }
export interface CarCatalogue { groups: CarGroup[]; tree: CarCategory[] }
export interface CarPartType { id: number; name: string; original: string }
export interface CarArticle {
  artId: number;
  article: string;
  brand: string;
  criteria: Array<{ name: string; value: string }>;
  medias: UmapiMedia[];
  name: string | null;
}
export interface CarArticlePage { articles: CarArticle[]; total: number }
export interface CategoryMatch { id: number; leaf: boolean; name: string; path: string[]; related?: true }

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function list(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.flatMap((item) => { const row = record(item); return row ? [row] : []; }) : [];
}

function text(value: unknown, max = 160): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const trimmed = String(value).replace(/\s+/gu, " ").trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function id(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d{1,12}$/u.test(value.trim()) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/** The catalogue's section names as a customer would put them (only where they differ). */
const GROUP_NAMES: Readonly<Record<string, string>> = {
  "Фильтр": "Фильтры",
  "Тормозная система": "Тормоза",
  "Ходовая часть": "Подвеска",
  "Техническое обслуживание": "Техобслуживание",
  "Охлаждение/Кондиционирование": "Охлаждение и печка",
  "Стёкла/Стеклоочищение": "Стёкла и щётки",
  "Передача силы": "Трансмиссия",
  "Система выпуска ОГ": "Выхлопная система",
  "Система зажигания/накаливания": "Зажигание",
  "Подготовка топлива": "Топливная система",
  "Внутренняя отделка": "Салон",
  "Освещение": "Свет",
  "Электрооборудование": "Электрика",
  "Рулевое управление": "Рулевое",
};
/** What a section holds, in the words of the shop (the catalogue's own first categories are often service ones). */
const GROUP_HINTS: Readonly<Record<string, string>> = {
  "Техобслуживание": "фильтры, свечи, ремни, щётки",
  "Фильтры": "масляный, воздушный, салона, топливный",
  "Тормоза": "колодки, диски, суппорты, шланги",
  "Подвеска": "амортизаторы, пружины, рычаги, опоры",
  "Двигатель": "прокладки, ремни, датчики, опоры",
  "Охлаждение и печка": "помпа, термостат, радиатор",
  "Рулевое": "наконечники, тяги, пыльники, насос",
  "Электрика": "генератор, стартер, аккумулятор",
  "Зажигание": "свечи, катушки, провода",
  "Свет": "фары, фонари, лампы",
  "Стёкла и щётки": "щётки, моторчик, омыватель",
  "Трансмиссия": "сцепление, ШРУС, приводы",
  "Топливная система": "насос, фильтр, форсунки",
  "Выхлопная система": "глушитель, катализатор, крепления",
  "Кузов": "бампер, крылья, зеркала, капот",
  "Салон": "ручки, стеклоподъёмники, панели",
};
/** The catalogue's service categories: never a hint. */
const SERVICE_CATEGORY = /поиск артикула|общая схема|интервал|дополнительные работы|инструмент/iu;

/** Shown first: what is bought most often for a car. */
const GROUP_ORDER = ["Техобслуживание", "Фильтры", "Тормоза", "Подвеска", "Двигатель", "Охлаждение и печка", "Рулевое", "Электрика", "Зажигание", "Свет", "Стёкла и щётки", "Трансмиссия", "Топливная система", "Выхлопная система", "Кузов", "Салон", "Комплектующие"];

/** Part types the catalogue names as a list of words («Фильтр, воздух во внутренном пространстве»). */
const TYPE_NAMES: Readonly<Record<string, string>> = {
  "Фильтр, воздух во внутренном пространстве": "Фильтр салона",
  "Фильтр, воздух во внутреннем пространстве": "Фильтр салона",
  "Тормозные колодки, дисковый тормоз": "Колодки дисковых тормозов",
  "Комплект тормозных колодок, дисковый тормоз": "Колодки дисковых тормозов",
  "Комплект тормозных колодок": "Тормозные колодки",
  "Амортизатор": "Амортизатор",
  "Свеча зажигания": "Свеча зажигания",
  "Щетка стеклоочистителя": "Щётка стеклоочистителя",
  "Комплект ремня ГРМ": "Комплект ремня ГРМ",
  "Поликлиновой ремень": "Ремень приводной (поликлиновой)",
  "Топливный фильтр": "Топливный фильтр",
  "Масляный фильтр": "Масляный фильтр",
  "Воздушный фильтр": "Воздушный фильтр",
};

function readable(name: string): string {
  return GROUP_NAMES[name] ?? TYPE_NAMES[name] ?? name;
}

function normalizeTree(value: unknown, depth = 0): CarCategory[] {
  if (depth > 8) return [];
  return list(value).flatMap((row) => {
    const categoryId = id(row.CATEGORY_ID);
    const name = text(row.DES, 120);
    return categoryId && name ? [{ children: normalizeTree(row.CHILD, depth + 1), id: categoryId, name: readable(name) }] : [];
  });
}

function findNode(tree: readonly CarCategory[], wanted: number): CarCategory | null {
  for (const node of tree) {
    if (node.id === wanted) return node;
    const inside = findNode(node.children, wanted);
    if (inside) return inside;
  }
  return null;
}

/** Categories?type=PC&ID={car}: the tree and the quick sections over it. */
export function normalizeCarCatalogue(payload: unknown): CarCatalogue {
  const body = record(payload);
  const tree = normalizeTree(body?.root);
  const groups = list(body?.quic).flatMap((row): CarGroup[] => {
    const groupId = id(row.QSI_ID);
    const original = text(row.DES, 80);
    const categoryIds = (Array.isArray(row.CATEGORY_IDS) ? row.CATEGORY_IDS : []).map(id).filter((item): item is number => item !== null && findNode(tree, item) !== null);
    if (!groupId || !original || categoryIds.length === 0) return [];
    // A hint of what is inside, from the categories themselves: «масляный, воздушный, салона».
    const inside = categoryIds.flatMap((categoryId) => {
      const node = findNode(tree, categoryId)!;
      return node.children.length > 0 ? node.children.map((child) => child.name) : [node.name];
    });
    const name = readable(original);
    const hint = GROUP_HINTS[name] ?? [...new Set(inside.filter((item) => !SERVICE_CATEGORY.test(item)).map((item) => item.toLowerCase()))].slice(0, 3).join(", ");
    return [{ categoryIds, hint, id: groupId, name }];
  });
  const rank = (name: string) => { const index = GROUP_ORDER.indexOf(name); return index === -1 ? GROUP_ORDER.length : index; };
  groups.sort((a, b) => rank(a.name) - rank(b.name));
  return { groups, tree };
}

/** Products/one?CATEGORY_ID&ID: the part types of one category for the car. */
export function normalizePartTypes(payload: unknown): CarPartType[] {
  const seen = new Set<number>();
  return list(payload).flatMap((row) => {
    const typeId = id(row.PT_ID);
    const original = text(row.PRODUCT, 120);
    if (!typeId || !original || seen.has(typeId)) return [];
    seen.add(typeId);
    return [{ id: typeId, name: readable(original), original }];
  });
}

/** Articles?PT_IDS&ID: one page (at most 100 — the API refuses more) of the parts of a type that fit the car. */
export function normalizeCarArticles(payload: unknown): CarArticlePage {
  const body = record(payload);
  const articles = list(body?.data).flatMap((row): CarArticle[] => {
    const artId = id(row.ART_ID);
    const article = text(row.ARTICLE_NR, 64);
    const brand = text(row.BRAND, 80);
    if (!artId || !article || !brand) return [];
    const criteria = list(row.CRITERIAS).flatMap((item) => {
      const name = text(item.CRI_DES ?? item.CRI_SHORT_DES, 60)?.replace(/\s*\[[^\]]*\]\s*$/u, "");
      const unit = text(item.CRI_UNIT_DES, 20);
      const value = text(item.DES, 80) ?? (text(item.VALUE, 60) ? `${text(item.VALUE, 60)}${unit ? ` ${unit}` : ""}` : null);
      return name && value ? [{ name: name[0]!.toUpperCase() + name.slice(1), value }] : [];
    }).slice(0, 4);
    const supId = id(row.SUP_ID);
    const medias = list(row.MEDIAS)
      .map((item) => ({ file: text(item.FILE_NAME, 300), sort: typeof item.SORT === "number" ? item.SORT : 0, supId: id(item.SUP_ID) ?? supId }))
      .filter((item): item is { file: string; sort: number; supId: number | null } => item.file !== null && /\.(?:jpe?g|png|webp|gif)$/iu.test(item.file))
      .sort((a, b) => a.sort - b.sort)
      .slice(0, 1)
      .map(({ file, supId: supplier }) => ({ file, supId: supplier }));
    const name = text(row.COMPLETE_DES ?? row.DES, 120);
    return [{ artId, article, brand, criteria, medias, name: name ? readable(name) : null }];
  });
  const total = typeof body?.rows === "number" && Number.isSafeInteger(body.rows) && body.rows >= 0 ? body.rows : articles.length;
  return { articles, total };
}

const STOP_WORDS = new Set(["для", "на", "и", "в", "к", "с", "по", "под", "от", "мне", "нужен", "нужна", "нужны", "купить"]);
/** What customers type for a section the catalogue names otherwise. */
const SYNONYMS: Readonly<Record<string, string>> = {
  салонный: "салона", салонник: "салона", колодки: "колодка", колодок: "колодка", дворники: "щетка", дворник: "щетка",
  щетки: "щетка", щётки: "щетка", амортизаторы: "амортизатор", стойки: "амортизатор", стойка: "амортизатор", лампочка: "лампа",
  лампочки: "лампа", свечи: "свеча", помпа: "водяной",
};

function words(value: string): string[] {
  return value.toLowerCase().replace(/ё/gu, "е").match(/[\p{L}\p{N}]+/gu) ?? [];
}

function stem(word: string): string {
  return word.length <= 4 ? word : word.slice(0, Math.max(4, word.length - 2));
}

const PRESSURE_SYSTEMS = [
  { words: /^(масл|смаз)/u, category: /^(система смазки|смазка двигателя|смазочная система)$/iu },
  { words: /^топлив/u, category: /^(топливная система|система подачи топлива|подготовка топливной смеси)$/iu },
  { words: /^(турбин|турбонаддув|наддув)/u, category: /^(турбонаддув|система наддува|турбонагнетатель)$/iu },
  { words: /^(шин|колес)/u, category: /^(шины|колеса|контроль давления в шинах)$/iu },
];

function pressureSystems(asked: string[]) {
  if (!asked.some((word) => word.startsWith("давлен"))) return [];
  const context = asked.filter((word) => !/^(давлен|датчик|регулятор)/u.test(word));
  const scoped = PRESSURE_SYSTEMS.filter((system) => context.some((word) => system.words.test(word)));
  if (context.length > 0 && !context.every((word) => scoped.some((system) => system.words.test(word)))) return [];
  return context.length > 0 ? scoped : PRESSURE_SYSTEMS;
}

/** The categories a typed request names («фильтр салона», «колодки»): every word starts a word of the name. */
export function matchCarCategories(tree: readonly CarCategory[], query: string, limit = 12): CategoryMatch[] {
  const asked = words(query).filter((word) => !STOP_WORDS.has(word) && word.length >= 2);
  const wanted = asked.map((word) => stem(SYNONYMS[word] ?? word));
  if (wanted.length === 0) return [];
  const nearby = pressureSystems(asked);
  const matches: Array<CategoryMatch & { score: number }> = [];
  const related: Array<CategoryMatch & { score: number }> = [];
  const visit = (node: CarCategory, path: string[]): void => {
    const own = words(node.name);
    if (wanted.every((want) => own.some((word) => word.startsWith(want)))) {
      matches.push({ id: node.id, leaf: node.children.length === 0, name: node.name, path, score: (own.length - wanted.length) * 2 + path.length + (node.children.length === 0 ? 0 : 1) });
    }
    if (nearby.some((system) => system.category.test(node.name.replace(/ё/giu, "е")))) {
      related.push({ id: node.id, leaf: node.children.length === 0, name: node.name, path, related: true, score: path.length });
    }
    for (const child of node.children) visit(child, [...path, node.name]);
  };
  for (const root of tree) visit(root, []);
  // One category often stands under two sections («Фильтр салона» in «Фильтр» and in «Отопление»): shown once.
  const seen = new Set<string>();
  return (matches.length > 0 ? matches : related).sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, "ru"))
    .filter((match) => {
      const key = `${match.leaf ? "leaf" : "node"}:${match.name.toLowerCase()}`;
      return seen.has(key) ? false : (seen.add(key), true);
    })
    .slice(0, limit)
    .map(({ score: _score, ...match }) => match);
}

/** A category of the tree by id, with its path of section names. */
export function categoryOf(tree: readonly CarCategory[], wanted: number): { node: CarCategory; path: string[] } | null {
  const walk = (nodes: readonly CarCategory[], path: string[]): { node: CarCategory; path: string[] } | null => {
    for (const node of nodes) {
      if (node.id === wanted) return { node, path };
      const inside = walk(node.children, [...path, node.name]);
      if (inside) return inside;
    }
    return null;
  };
  return walk(tree, []);
}

/** Parts that go with the main one: a sensor, a gasket, a fitting kit — never what a customer means by the section. */
const ACCESSORY = /^(?:датчик|сигнализатор|прокладка|комплект принадлежностей|принадлежности|болт|винт|гайка|крепление|кронштейн|монтажный|уплотн|пыльник|защитн|ремкомплект|ремонтный комплект|комплект монтажный)/iu;

/**
 * The part type a section means when it holds several («Тормозная колодка»: the pads, not their wear sensor): the
 * one named as the section, else the only one whose name shares the section's words and is not an accessory.
 */
export function mainPartType(types: readonly CarPartType[], category: string): CarPartType | null {
  if (types.length === 1) return types[0]!;
  const same = types.find((item) => item.name.toLowerCase() === category.toLowerCase());
  if (same) return same;
  const wanted = words(category).filter((word) => word.length >= 4).map(stem);
  const score = (item: CarPartType) => {
    if (ACCESSORY.test(item.name)) return 0;
    const own = words(item.name);
    return wanted.filter((want) => own.some((word) => word.startsWith(want))).length;
  };
  const ranked = types.map((item) => ({ item, score: score(item) })).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
  if (ranked.length === 0 || (ranked.length > 1 && ranked[0]!.score === ranked[1]!.score)) return null;
  return ranked[0]!.item;
}
