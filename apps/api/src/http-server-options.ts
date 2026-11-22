import { CATALOG_PUBLIC_SLUG_MAX_LENGTH } from "@an30/contracts";

export const API_HTTP_SERVER_OPTIONS = {
  // CommerceML chunks top out at 8 MiB. Chat videos are deliberately
  // capped at 15 MiB in the multipart limits, with a little framing headroom.
  bodyLimit: 16 * 1024 * 1024,
  requestTimeout: 35_000,
  // Fastify answers 414 to a path parameter longer than 100 characters, and
  // product slugs built from 1C names run longer than that.
  routerOptions: { maxParamLength: CATALOG_PUBLIC_SLUG_MAX_LENGTH },
};
