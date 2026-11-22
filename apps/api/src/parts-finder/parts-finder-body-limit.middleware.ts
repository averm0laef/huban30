import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";

// The largest legitimate body is a 140-character query plus eight choices.
export const PARTS_FINDER_MAX_BODY_BYTES = 4 * 1024;

/**
 * Runs before Fastify parses the body, so an oversized or chunked request
 * to a parts-finder route is refused without reading it (the API's global
 * limit is 16 MiB for 1C uploads).
 */
@Injectable()
export class PartsFinderBodyLimitMiddleware implements NestMiddleware {
  use(request: IncomingMessage, response: ServerResponse, next: () => void) {
    if (request.method !== "POST") return next();
    const declared = request.headers["content-length"];
    const length = declared === undefined ? Number.NaN : Number(declared);
    const chunked = declared === undefined && request.headers["transfer-encoding"] !== undefined;
    if (chunked || (declared !== undefined && (!Number.isSafeInteger(length) || length > PARTS_FINDER_MAX_BODY_BYTES))) {
      response.statusCode = 413;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.setHeader("cache-control", "private, no-store");
      response.end(JSON.stringify({ code: "parts_finder_body_too_large", error: "Запрос слишком большой." }));
      return;
    }
    next();
  }
}
