import { errorCodes, type FastifyInstance, type FastifyRequest } from "fastify";

export const ONE_C_EXCHANGE_HTTP_PATH = "/api/v1/integrations/1c/exchange";
export const ONE_C_FILE_CHUNK_LIMIT_BYTES = 8 * 1024 * 1024;

function isOneCExchangeUpload(method: string, pathname: string | undefined): boolean {
  return method === "POST" && (pathname === ONE_C_EXCHANGE_HTTP_PATH || pathname === `${ONE_C_EXCHANGE_HTTP_PATH}/secondary`);
}

async function readBoundedBody(
  request: FastifyRequest,
  payload: FastifyRequest["raw"],
  bodyLimitBytes: number,
): Promise<Buffer> {
  const contentLength = Number(request.headers["content-length"]);
  if (contentLength > bodyLimitBytes) {
    throw new errorCodes.FST_ERR_CTP_BODY_TOO_LARGE();
  }

  const chunks: Buffer[] = [];
  let receivedLength = 0;
  for await (const chunk of payload) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    receivedLength += buffer.length;
    if (receivedLength > bodyLimitBytes) {
      throw new errorCodes.FST_ERR_CTP_BODY_TOO_LARGE();
    }
    chunks.push(buffer);
  }

  if (!Number.isNaN(contentLength) && receivedLength !== contentLength) {
    throw new errorCodes.FST_ERR_CTP_INVALID_CONTENT_LENGTH();
  }
  return Buffer.concat(chunks, receivedLength);
}

/**
 * Fastify's built-in parsers intentionally reject unknown media types. 1C is
 * the sole exception: CommerceML sends raw file chunks either as
 * application/octet-stream or without Content-Type. Keeping this parser in
 * stream mode lets it reject every other route before buffering its body.
 */
export function registerOneCExchangeRawBodyParser(
  server: FastifyInstance,
): void {
  server.addHook("onRoute", (route) => {
    if (typeof route.method === "string" && isOneCExchangeUpload(route.method, route.url)) {
      route.bodyLimit = ONE_C_FILE_CHUNK_LIMIT_BYTES;
    }
  });
  server.addContentTypeParser("*", async (
    request: FastifyRequest,
    payload: FastifyRequest["raw"],
  ) => {
    if (!isOneCExchangeUpload(request.method, request.routeOptions.url)) {
      throw new errorCodes.FST_ERR_CTP_INVALID_MEDIA_TYPE();
    }
    return readBoundedBody(request, payload, ONE_C_FILE_CHUNK_LIMIT_BYTES);
  });
}
