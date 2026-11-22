import { normalizeArticleNumber, swapKeyboardLayoutToCyrillic } from "@an30/contracts";

import { catalogSearchHref } from "./catalog-search-url";
import { categoryTiles } from "./store-categories";

const services = [
  { href: "/delivery", label: "Доставка и самовывоз", terms: /^(?:условия |стоимость |сроки? )?(?:доставк[аи]|самовывоз)(?:$|\s+(?:заказа|и\s+самовывоз))|^как (?:забрать|получить) заказ/iu },
  { href: "/returns", label: "Возврат товара", terms: /^(?:(?:условия |оформить |правила )?возврат(?:\s|$)|как вернуть(?:\s|$))/iu },
  { href: "/how-to-order", label: "Как сделать заказ", terms: /^(?:как (?:сделать|создать|оформить)|оформление) заказ/iu },
  { href: "/profile", label: "Мои заказы", terms: /^(?:статус заказа|мои заказы|где мой заказ|как (?:отследить|отменить) заказ|отследить заказ)$/iu },
  { href: "/profile?tab=addresses", label: "Адреса в личном кабинете", terms: /^(?:изменить адрес|адрес доставки|мои адреса)$/iu },
  { href: "/auth?mode=forgot", label: "Восстановление пароля", terms: /^(?:забыл[аи]? пароль|не помню пароль|восстанов(?:ить|ление) парол[ья])$/iu },
  { href: "/profile?tab=security", label: "Настройки безопасности", terms: /^(?:сменить пароль|смена пароля|изменить пароль)$/iu },
  { href: "/map", label: "Адрес и график магазина", terms: /^(?:адрес(?: магазина)?|часы работы|график работы|как проехать|где магазин)$/iu },
  { href: "/contacts", label: "Контакты магазина", terms: /^(?:телефон(?: магазина)?|контакт(?:ы|ная информация)|как (?:связаться|позвонить))$/iu },
  { href: "/warranty", label: "Гарантия", terms: /^(?:условия гарантии|гарантия|гарантия на товар)$/iu },
  { href: "/profile?tab=wishlist", label: "Избранное", terms: /^(?:избранное|сохран[её]нные товары)$/iu },
];

const matchingTerms: Record<string, RegExp> = {
  "motornye-masla": /масл|моторн|(^|[^0-9])(0|5|10|15|20)\s?[wвц]\s?-?\s?[2-6]0|(^|\s)oil($|\s)/iu,
  filtry: /ф[иоы]л[ь]?т|фильр|filt/iu,
  "tormoznaya-sistema": /тормоз|колодк|калодк|колодок|(^|\s)диск/iu,
  akkumulyatory: /аккум|акк?ам|(^|\s)акб($|\s)|батаре/iu,
  "transmissionnye-masla": /трансмис|(^|[^0-9])(75|80|85)\s?[wвц]\s?-?\s?(80|85|90|140)/iu,
  antifriz: /антифр|антифир|тосол|охлаждающ/iu,
  avtolampy: /ламп|(^|\s)[hн]\s?[1-9]{1,2}($|\s)|(^|\s)w5w($|\s)/iu,
  shchetki: /дворник|щ[её]т[ко]|стеклоочист/iu,
  avtohimiya: /автохими|очистител|смазк|омыва|герметик|присадк/iu,
  instrumenty: /инструмент|ключ|домкрат/iu,
};

/**
 * Sections worth offering for a query, also when it was typed with the
 * keyboard layout left on English ("vfckj" -> "масло").
 */
function sectionMatches(pattern: RegExp, query: string): boolean {
  const value = query.trim().replace(/\s+/gu, " ");
  if (pattern.test(value)) return true;
  return !/[а-яё]/iu.test(value) && pattern.test(swapKeyboardLayoutToCyrillic(value));
}

export function searchServiceLinks(query: string) {
  const value = query.trim().replace(/\s+/gu, " ").replace(/[?!]+$/u, "");
  return services.filter(link => link.terms.test(value)).map(({ href, label }) => ({ href, label }));
}

export function suggestedCatalogSections(query: string) {
  return categoryTiles.filter(tile => {
    const pattern = matchingTerms[tile.key];
    return pattern !== undefined && sectionMatches(pattern, query) && tile.query !== query.trim().toLowerCase();
  })
    .slice(0, 3).map(tile => ({ href: catalogSearchHref(tile.query), label: tile.label }));
}

export function directSearchProduct(query: string, items: ReadonlyArray<{ sku: string; slug: string }>, total: number) {
  if (total !== 1 || items.length !== 1 || !/^[\p{L}\d][\p{L}\d._/+ -]*$/u.test(query) || !/\d/u.test(query)) return null;
  const item = items[0];
  return item && normalizeArticleNumber(query) === normalizeArticleNumber(item.sku) ? item.slug : null;
}
