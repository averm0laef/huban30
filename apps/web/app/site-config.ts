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
export const STORE_STREET = "ул. Куйбышева, 118А";
export const STORE_LOCALITY = "Чернышевск";
export const STORE_REGION = "Забайкальский край";
export const STORE_COUNTRY = "RU";
