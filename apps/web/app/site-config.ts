/**
 * Single source of the public origin and indexing policy.
 *
 * The base URL is configuration, never a hard-coded host, so staging and
 * production emit their own canonical links from the same image.
 */
const FALLBACK_BASE_URL = "http://localhost:3000";

export type DeploymentEnvironment = "development" | "staging" | "production";

export function deploymentEnvironment(): DeploymentEnvironment {
  const value = process.env.DEPLOYMENT_ENVIRONMENT;
  return value === "production" || value === "staging" ? value : "development";
}

/** Only the production deployment may be crawled. */
export function indexingAllowed(): boolean {
  return deploymentEnvironment() === "production";
}

export function siteBaseUrl(): string {
  const configured = process.env.APP_BASE_URL?.trim();
  if (!configured) return FALLBACK_BASE_URL;
  try {
    return new URL(configured).origin;
  } catch {
    return FALLBACK_BASE_URL;
  }
}

export function absoluteUrl(pathname: string): string {
  return new URL(pathname, `${siteBaseUrl()}/`).toString();
}

/** Paths that must never reach a search index, on any environment. */
export const PRIVATE_PATHS = ["/admin", "/auth", "/checkout", "/profile", "/chat", "/api/"] as const;

export const SITE_NAME = "АН-30";
export const SITE_LEGAL_NAME = "АН-30 Автозапчасти";
export const STORE_PHONE = "+79244742605";
export const STORE_PHONE_DISPLAY = "+7 (924) 474-26-05";
export const STORE_STREET = "ул. Куйбышева, 118А";
export const STORE_LOCALITY = "Чернышевск";
export const STORE_REGION = "Забайкальский край";
export const STORE_COUNTRY = "RU";
export const STORE_HOURS = "Ежедневно 09:00–19:00";
/** Schema.org opening hours for the storefront markup. */
export const STORE_HOURS_SCHEMA = "Mo-Su 09:00-19:00";
/** The shop's own organisation card on Яндекс Карты (supplied by the owner). */
export const STORE_MAP_URL =
  "https://yandex.ru/maps/?ll=116.995334%2C52.526654&mode=poi&poi%5Bpoint%5D=116.995560%2C52.525390&poi%5Buri%5D=ymapsbm1%3A%2F%2Forg%3Foid%3D207536410283&z=17";
/** Exact pickup point, shared by the map embed and the Schema.org data. */
export const STORE_GEO = { latitude: 52.52539, longitude: 116.99556 } as const;

export interface MessengerLink {
  /** Short label shown next to the icon. */
  label: string;
  /** Stable key used to pick the icon. */
  id: "telegram" | "whatsapp" | "vk" | "max";
  handle: string;
  href: string;
}

/**
 * Messenger entry points carried over from the previous storefront.
 *
 * These are the shop's published public accounts.
 */
export const MESSENGERS: MessengerLink[] = [
  { handle: "@an30_autoparts", href: "https://t.me/an30_autoparts", id: "telegram", label: "Telegram" },
  { handle: STORE_PHONE_DISPLAY, href: `https://wa.me/${STORE_PHONE.replace("+", "")}`, id: "whatsapp", label: "WhatsApp" },
  { handle: "an30_autoparts", href: "https://vk.com/an30_autoparts", id: "vk", label: "ВКонтакте" },
];
