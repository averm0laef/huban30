import { corsHeadersFor } from "./cors.ts";

export function disabledLegacyFunction(request: Request): Response {
  const headers = corsHeadersFor(request);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  return new Response(
    JSON.stringify({
      error: "legacy_function_disabled",
      message: "This legacy integration is disabled during the autonomous migration.",
    }),
    {
      status: 410,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
    },
  );
}
