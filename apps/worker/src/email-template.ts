/**
 * Branded HTML for transactional e-mail (design canvas board «Письмо»).
 *
 * E-mail clients ignore web fonts, SVG and most CSS, so this is the classic
 * table layout with inline styles: a 600px card, ink-indigo header with the
 * large white logo PNG and a yellow rule, one bulletproof button, the plain link
 * as a fallback and the shop's contacts underneath. Images are served by
 * the storefront itself (`/email/*.png`), so nothing depends on a third
 * party; every image has alt text, so a client that blocks images still
 * reads correctly.
 */

export interface BrandedEmail {
  /** One line under the title in the header. */
  lead: string;
  /** Paragraphs of the body, plain text. */
  paragraphs: string[];
  action: { label: string; url: string };
  /** Yellow note under the button (why you got this, what to do if not you). */
  note: string;
  title: string;
}

export interface StoreFooter {
  address: string;
  hours: string;
  phoneDisplay: string;
  phoneHref: string;
  siteLabel: string;
  channels: Array<{ href: string; label: string }>;
}

export const DEFAULT_STORE_FOOTER: StoreFooter = {
  address: "Чернышевск, ул. Куйбышева, 118А",
  hours: "ежедневно 09:00–19:00",
  phoneDisplay: "+7 (924) 474-26-05",
  phoneHref: "tel:+79244742605",
  siteLabel: "an30.ru",
  channels: [
    { href: "https://t.me/an30_autoparts", label: "Telegram" },
    { href: "https://vk.com/an30_autoparts", label: "ВКонтакте" },
  ],
};

const INK = "#140f57";
const BRAND = "#1800e0";
const TEXT = "#12132b";
const MUTED = "#5b5f78";
const ACCENT = "#f5c400";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderBrandedEmailHtml(email: BrandedEmail, publicBaseUrl: string, footer: StoreFooter = DEFAULT_STORE_FOOTER): string {
  const base = publicBaseUrl.replace(/\/+$/u, "");
  const asset = (path: string) => escapeHtml(`${base}${path}`);
  const actionUrl = escapeHtml(email.action.url);
  const paragraphs = email.paragraphs
    .map((text) => `<p style="margin:0 0 22px;font-size:16px;line-height:1.6;color:${TEXT};">${escapeHtml(text)}</p>`)
    .join("");
  const pill = (href: string, label: string, primary = false) =>
    `<a href="${escapeHtml(href)}" style="display:inline-block;margin:4px;padding:9px 16px;border:1.5px solid ${primary ? BRAND : "#dfe1ec"};border-radius:999px;color:${primary ? BRAND : TEXT};font-size:13px;font-weight:bold;text-decoration:none;">${escapeHtml(label)}</a>`;
  const channels = [
    pill(footer.phoneHref, footer.phoneDisplay, true),
    pill(base, `Сайт ${footer.siteLabel}`),
    ...footer.channels.map((channel) => pill(channel.href, channel.label)),
  ].join("");
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(email.title)}</title>
</head>
<body style="margin:0;padding:0;background:#eef0f6;">
<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(email.lead)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef0f6;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:22px;overflow:hidden;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;">
<tr><td align="center" style="background:${INK};padding:34px 36px 32px;text-align:center;">
<a href="${escapeHtml(base)}" style="text-decoration:none;"><img src="${asset("/email/logo-white@2x.png")}" width="220" alt="АН-30 Автозапчасти" style="display:block;width:220px;max-width:70%;height:auto;margin:0 auto;border:0;color:#ffffff;font-size:24px;font-weight:bold;"></a>
<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:24px auto 20px;"><tr><td style="width:48px;height:3px;border-radius:2px;background:${ACCENT};font-size:0;line-height:0;">&nbsp;</td></tr></table>
<p style="margin:0;color:#ffffff;font-size:26px;font-weight:bold;line-height:1.2;">${escapeHtml(email.title)}</p>
<p style="margin:8px 0 0;color:#c9c6ff;font-size:15px;line-height:1.5;">${escapeHtml(email.lead)}</p>
</td></tr>
<tr><td style="padding:32px 36px 10px;">
${paragraphs}
<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td style="border-radius:12px;background:${BRAND};">
<a href="${actionUrl}" style="display:inline-block;padding:16px 34px;border-radius:12px;background:${BRAND};color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;">${escapeHtml(email.action.label)}</a>
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;"><tr><td style="padding:14px 16px;border:1.5px solid #dfe1ec;border-radius:12px;font-size:13px;color:${MUTED};line-height:1.5;">Кнопка не работает? Скопируйте ссылку в браузер:<br><a href="${actionUrl}" style="color:${BRAND};word-break:break-all;">${actionUrl}</a></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr><td style="padding:14px 16px;border-radius:12px;background:#fff8dc;font-size:13px;color:#5a4600;line-height:1.5;">${escapeHtml(email.note)}</td></tr></table>
</td></tr>
<tr><td align="center" style="padding:24px 36px 28px;border-top:1px solid #e6e8f0;text-align:center;">
<p style="margin:0 0 4px;font-size:14px;font-weight:bold;color:${TEXT};">Магазин АН-30</p>
<p style="margin:0 0 16px;font-size:13px;color:${MUTED};">${escapeHtml(footer.address)} · ${escapeHtml(footer.hours)}</p>
<div>${channels}</div>
<p style="margin:16px 0 0;font-size:12px;color:#6b6f88;">Письмо отправлено автоматически, отвечать на него не нужно.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** The same content as plain text, for clients that do not show HTML. */
export function renderBrandedEmailText(email: BrandedEmail, footer: StoreFooter = DEFAULT_STORE_FOOTER): string {
  return [
    email.title,
    "",
    ...email.paragraphs,
    "",
    `${email.action.label}: ${email.action.url}`,
    "",
    email.note,
    "",
    `Магазин АН-30 · ${footer.address} · ${footer.hours} · ${footer.phoneDisplay}`,
  ].join("\n");
}
