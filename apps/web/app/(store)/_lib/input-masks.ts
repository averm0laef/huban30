/**
 * Input masks of the storefront forms (Claude Design canvas «совместимость и аналоги», board «Маски полей и
 * предпросмотр фото», 24.11.2026). The customer types as they are used to; the server receives what it always did.
 */

/**
 * A phone typed in any of the usual ways — «89244742605», «9244742605», «+7 924 474-26-05» — shown as
 * «+7 (924) 474-26-05». Another country's number keeps its «+» and code, digits only. `e164` is what the server
 * takes («+79244742605»); null until the number is complete.
 */
export function formatPhone(raw: string): { display: string; e164: string | null } {
  const plus = raw.trim().startsWith("+");
  let digits = raw.replace(/\D/gu, "");
  if (!digits) return { display: plus ? "+" : "", e164: null };
  // Russian numbers: «8…» and a bare «9…» are +7.
  const russian = !plus ? digits.startsWith("8") || digits.startsWith("7") || digits.startsWith("9") : digits.startsWith("7");
  if (!russian) {
    digits = digits.slice(0, 15);
    return { display: `+${digits}`, e164: digits.length >= 7 && /^[1-9]/u.test(digits) ? `+${digits}` : null };
  }
  if (digits.startsWith("8") || digits.startsWith("7")) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  const parts = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 8), digits.slice(8, 10)];
  let display = "+7";
  if (parts[0]) display += ` (${parts[0]}${parts[0].length === 3 ? ")" : ""}`;
  if (parts[1]) display += ` ${parts[1]}`;
  if (parts[2]) display += `-${parts[2]}`;
  if (parts[3]) display += `-${parts[3]}`;
  return { display, e164: digits.length === 10 ? `+7${digits}` : null };
}

export const PHONE_INCOMPLETE_MESSAGE = "Введите номер полностью: +7 (XXX) XXX-XX-XX";

/** An e-mail as typed: no spaces, the domain in small letters (the name part is left as the customer wrote it). */
export function normalizeEmail(raw: string): string {
  const value = raw.replace(/\s+/gu, "");
  const at = value.lastIndexOf("@");
  return at === -1 ? value : `${value.slice(0, at + 1)}${value.slice(at + 1).toLowerCase()}`;
}

/** The domains customers here use most, and the slips they make in them. */
const DOMAIN_FIXES: Readonly<Record<string, string>> = {
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gmail.co": "gmail.com", "gmail.con": "gmail.com", "gmail.ru": "gmail.com",
  "gamil.com": "gmail.com", "gnail.com": "gmail.com", "gmail.cm": "gmail.com",
  "yandex.ry": "yandex.ru", "yandx.ru": "yandex.ru", "yanex.ru": "yandex.ru", "yadex.ru": "yandex.ru", "yandex.r": "yandex.ru",
  "mail.ry": "mail.ru", "mial.ru": "mail.ru", "mail.r": "mail.ru", "mai.ru": "mail.ru",
  "list.ry": "list.ru", "bk.ry": "bk.ru", "inbox.ry": "inbox.ru", "rambler.ry": "rambler.ru", "ramble.ru": "rambler.ru",
};

/** «ivan@gmial.com» → «ivan@gmail.com»; null when the address looks right. */
export function emailSuggestion(raw: string): string | null {
  const value = normalizeEmail(raw);
  const at = value.lastIndexOf("@");
  if (at < 1) return null;
  const fixed = DOMAIN_FIXES[value.slice(at + 1)];
  return fixed ? `${value.slice(0, at + 1)}${fixed}` : null;
}

/**
 * A VIN as typed: capitals, no spaces; in a 17-character VIN, which never holds I, O or Q, those become 1 and 0.
 * A Japanese frame number («NZE141-6012345») is left as it is — it may hold any letter.
 */
export function normalizeVin(raw: string): string {
  const value = raw.toUpperCase().replace(/\s+/gu, "");
  if (value.includes("-") || value.length !== 17) return value;
  return value.replace(/[IO]/gu, (char) => (char === "I" ? "1" : "0")).replace(/Q/gu, "0");
}
