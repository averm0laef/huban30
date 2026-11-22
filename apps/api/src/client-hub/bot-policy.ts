export interface FaqRule { title: string; keywords: string[]; answer: string; approved: boolean }
export function botDecision(text: string, faq: FaqRule[]): { body: string; handoff: boolean } {
  const normalized = text.toLocaleLowerCase("ru").normalize("NFKC").replace(/ё/gu, "е").trim();
  if (/^(\/start|привет|здравствуйте|добрый день)[!.\s]*$/u.test(normalized)) {
    return { body: "Здравствуйте! Это АН30. Напишите, что вас интересует. Для подбора запчасти укажите марку автомобиля, артикул или VIN — менеджер проверит совместимость и наличие.", handoff: false };
  }
  // Catalog promises always require a human checking 1C. FAQ must never
  // capture a mixed question such as “доставка и цена фильтра 123”.
  const productQuestion = /\d|vin|вин|артикул|цен|стоим|налич|подбор|запчаст|фильтр|колод|детал|масл|подойдет|совмест|заказ/iu.test(normalized);
  const matches = !productQuestion && normalized.length <= 160 ? faq.filter((rule) => rule.approved && rule.keywords.some((keyword) => {
    const term = keyword.toLocaleLowerCase("ru").normalize("NFKC").replace(/ё/gu, "е").trim();
    return term && normalized.split(/[^\p{L}\p{N}]+/u).includes(term);
  })) : [];
  if (matches.length === 1) return { body: matches[0]!.answer, handoff: false };
  return { body: "Обращение в очереди. Как только менеджер освободится, он подключится и ответит здесь. Для подбора детали можно добавить артикул, марку автомобиля или VIN.", handoff: true };
}
