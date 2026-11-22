import fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import {
  ONE_C_EXCHANGE_HTTP_PATH,
  ONE_C_FILE_CHUNK_LIMIT_BYTES,
  registerOneCExchangeRawBodyParser,
} from "./one-c-exchange-raw-body-parser.js";

const servers: FastifyInstance[] = [];

async function createServer(): Promise<FastifyInstance> {
  const server = fastify({ bodyLimit: ONE_C_FILE_CHUNK_LIMIT_BYTES * 2 });
  registerOneCExchangeRawBodyParser(server);
  server.post(ONE_C_EXCHANGE_HTTP_PATH, async (request) => ({
    body: request.body instanceof Buffer ? request.body.toString("utf8") : null,
    contentType: request.headers["content-type"] ?? null,
  }));
  server.post(`${ONE_C_EXCHANGE_HTTP_PATH}/secondary`, async () => ({ accepted: true }));
  server.post("/api/v1/other", async (request) => ({ body: request.body }));
  await server.ready();
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("1C exchange raw body parser", () => {
  it("accepts an application/octet-stream Buffer only on the exchange route", async () => {
    const server = await createServer();
    const exchange = await server.inject({
      headers: { "content-type": "application/octet-stream" },
      method: "POST",
      payload: Buffer.from("commerce-ml"),
      url: `${ONE_C_EXCHANGE_HTTP_PATH}?type=catalog&mode=file`,
    });
    const other = await server.inject({
      headers: { "content-type": "application/octet-stream" },
      method: "POST",
      payload: Buffer.from("not-allowed"),
      url: "/api/v1/other",
    });

    expect(exchange.statusCode).toBe(200);
    expect(exchange.json()).toMatchObject({ body: "commerce-ml", contentType: "application/octet-stream" });
    expect(other.statusCode).toBe(415);
  });

  it("preserves raw uploads without Content-Type", async () => {
    const server = await createServer();
    const payload = "raw-without-a-media-type";
    const response = await server.inject({
      headers: { "content-length": String(Buffer.byteLength(payload)) },
      method: "POST",
      payload,
      url: ONE_C_EXCHANGE_HTTP_PATH,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ body: payload, contentType: null });
  });

  it("leaves specific parsers intact and bounds unknown 1C bodies", async () => {
    const server = await createServer();
    const json = await server.inject({
      headers: { "content-type": "application/json" },
      method: "POST",
      payload: JSON.stringify({ accepted: true }),
      url: "/api/v1/other",
    });
    const oversized = await server.inject({
      headers: { "content-type": "application/octet-stream" },
      method: "POST",
      payload: Buffer.alloc(ONE_C_FILE_CHUNK_LIMIT_BYTES + 1),
      url: ONE_C_EXCHANGE_HTTP_PATH,
    });

    expect(json.statusCode).toBe(200);
    expect(json.json()).toEqual({ body: { accepted: true } });
    expect(oversized.statusCode).toBe(413);
  });

  it("applies the chunk limit on the secondary source with a built-in content parser", async () => {
    const server = await createServer();
    const response = await server.inject({
      headers: { "content-type": "text/plain" },
      method: "POST",
      payload: "x".repeat(ONE_C_FILE_CHUNK_LIMIT_BYTES + 1),
      url: `${ONE_C_EXCHANGE_HTTP_PATH}/secondary`,
    });
    expect(response.statusCode).toBe(413);
  });
});
