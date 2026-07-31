const DEFAULT_ALLOWED_ORIGINS = ["https://an30.ru", "https://www.an30.ru"];

interface CorsOptions {
  allowedHeaders?: string;
  allowCredentials?: boolean;
}

function configuredOrigins(): Set<string> {
  const value = Deno.env.get("LEGACY_ALLOWED_ORIGINS");
  const origins = value
    ? value.split(",").map((origin) => origin.trim()).filter(Boolean)
    : DEFAULT_ALLOWED_ORIGINS;

  return new Set(origins);
}

export function corsHeadersFor(
  request: Request,
  options: CorsOptions = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": options.allowedHeaders
      ?? "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };

  const origin = request.headers.get("origin");
  if (origin && configuredOrigins().has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    if (options.allowCredentials) {
      headers["Access-Control-Allow-Credentials"] = "true";
    }
  }

  return headers;
}
