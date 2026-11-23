import { once } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { S3StorageProvider, type S3StorageSettings } from "./s3-storage.provider.js";

const SECRET = "fake-secret-access-key-0123456789";
const KEY_PATTERN = /^catalog\/\d{4}-\d{2}\/[0-9a-f-]{36}\.jpg$/u;

interface FakeObject { body: Buffer; contentType: string | undefined }
interface SeenRequest { authorization: string | undefined; method: string; url: string }

// A minimal path-style S3 endpoint: enough of PUT/GET/DELETE Object for the
// real AWS SDK to talk to over HTTP. Signature checking is covered by the
// suite below, which runs against a real S3-compatible server.
const objects = new Map<string, FakeObject>();
const seen: SeenRequest[] = [];
let oversizedKey: string | null = null;
let stalled = false;
let server: Server;
let endpoint: string;

async function body(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

beforeAll(async () => {
  const handle = (request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const key = decodeURIComponent(new URL(request.url ?? "/", "http://fake").pathname).slice(1);
      seen.push({ authorization: request.headers.authorization, method: request.method ?? "", url: request.url ?? "" });
      // A bucket that takes the connection and then goes silent.
      if (stalled) return;
      if (request.method === "PUT") {
        objects.set(key, { body: await body(request), contentType: request.headers["content-type"] });
        response.writeHead(200, { ETag: '"fake"' }).end();
        return;
      }
      if (request.method === "DELETE") {
        objects.delete(key);
        response.writeHead(204).end();
        return;
      }
      const object = objects.get(key);
      if (!object) {
        response.writeHead(404, { "Content-Type": "application/xml" })
          .end("<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>");
        return;
      }
      if (key === oversizedKey) {
        // Announces far more than the provider may buffer.
        response.writeHead(200, { "Content-Length": String(64 * 1024 * 1024) });
        response.write(Buffer.alloc(1024));
        return;
      }
      response.writeHead(200, { "Content-Length": String(object.body.length), "Content-Type": object.contentType })
        .end(object.body);
    })();
  };
  server = createServer(handle);
  // Like some S3 gateways, never answers "Expect: 100-continue": the body is
  // read only if the client sends it without waiting for the go-ahead.
  server.on("checkContinue", handle);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  objects.clear();
  seen.length = 0;
  oversizedKey = null;
  stalled = false;
});

afterAll(async () => {
  server.closeAllConnections();
  server.close();
  await once(server, "close");
});

function settings(overrides: Partial<S3StorageSettings> = {}): S3StorageSettings {
  return {
    accessKeyId: "FAKEACCESSKEYID",
    bucket: "an30-photos",
    endpoint,
    forcePathStyle: true,
    region: "ru-1",
    secretAccessKey: SECRET,
    ...overrides,
  };
}

describe("S3StorageProvider", () => {
  it("puts a photo into the bucket under an opaque catalog key and reads the same bytes back", async () => {
    const provider = new S3StorageProvider(settings());
    const photo = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

    const stored = await provider.store(photo, "jpg");

    expect(provider.name).toBe("s3");
    expect(stored.byteSize).toBe(photo.length);
    expect(stored.storageKey).toMatch(KEY_PATTERN);
    const inBucket = objects.get(`an30-photos/${stored.storageKey}`);
    expect(inBucket?.body.equals(photo)).toBe(true);
    expect(inBucket?.contentType).toBe("image/jpeg");
    expect((await provider.read(stored.storageKey)).equals(photo)).toBe(true);
  });

  it("opens a stored object as a stream with its size", async () => {
    const provider = new S3StorageProvider(settings());
    const stored = await provider.store(Buffer.from("streamed"), "jpg");

    const opened = await provider.open(stored.storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of opened.content) chunks.push(chunk as Buffer);

    expect(opened.byteSize).toBe(8);
    expect(Buffer.concat(chunks).toString("utf8")).toBe("streamed");
  });

  it("removes an object, and removing a missing one is not an error", async () => {
    const provider = new S3StorageProvider(settings());
    const stored = await provider.store(Buffer.from("gone"), "jpg");

    await provider.remove(stored.storageKey);
    await provider.remove(stored.storageKey);

    expect(objects.size).toBe(0);
    await expect(provider.read(stored.storageKey)).rejects.toThrow(/NoSuchKey|does not exist/u);
  });

  it("refuses keys and extensions outside the storage namespaces without calling the bucket", async () => {
    const provider = new S3StorageProvider(settings());

    await expect(provider.read("../other-bucket/secret.txt")).rejects.toThrow(/Unsafe storage key/u);
    await expect(provider.open("private/2026-11/019bf9ea-0d3e-7def-8c9a-000000000012.png"))
      .rejects.toThrow(/Unsafe storage key/u);
    await expect(provider.remove("catalog/2026-11/../../x.png")).rejects.toThrow(/Unsafe storage key/u);
    await expect(provider.store(Buffer.from("x"), "../sh")).rejects.toThrow(/Unsafe storage extension/u);
    expect(seen).toHaveLength(0);
  });

  it("does not buffer an object larger than the read limit", async () => {
    const provider = new S3StorageProvider(settings({ maxReadBytes: 1024 * 1024 }));
    const stored = await provider.store(Buffer.from("small"), "jpg");
    oversizedKey = `an30-photos/${stored.storageKey}`;

    await expect(provider.read(stored.storageKey)).rejects.toThrow(/larger than/u);
  });

  it("gives up on a bucket that accepts the connection and then stops answering", async () => {
    const provider = new S3StorageProvider(settings({ maxAttempts: 1, requestTimeoutMs: 200 }));
    stalled = true;

    const started = Date.now();
    await expect(provider.store(Buffer.from("stalled"), "jpg")).rejects.toThrow();
    await expect(provider.read("catalog/2026-11/019bf9ea-0d3e-7def-8c9a-000000000012.jpg")).rejects.toThrow();

    expect(Date.now() - started).toBeLessThan(3_000);
  }, 6_000);

  it("uploads a large photo to a bucket that never answers Expect: 100-continue", async () => {
    const provider = new S3StorageProvider(settings({ maxAttempts: 1, requestTimeoutMs: 1_500 }));
    const photo = Buffer.alloc(3 * 1024 * 1024, 7);

    const stored = await provider.store(photo, "jpg");

    expect(objects.get(`an30-photos/${stored.storageKey}`)?.body.equals(photo)).toBe(true);
  });

  it("signs every request with the access key and never sends the secret", async () => {
    const provider = new S3StorageProvider(settings());
    const stored = await provider.store(Buffer.from("signed"), "jpg");
    await provider.read(stored.storageKey);

    expect(seen.map((request) => request.method)).toEqual(["PUT", "GET"]);
    for (const request of seen) {
      expect(request.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=FAKEACCESSKEYID\/\d{8}\/ru-1\/s3\/aws4_request/u);
      expect(`${request.authorization} ${request.url}`).not.toContain(SECRET);
    }
  });
});

// The same provider against a real S3-compatible server (signature checking,
// real bucket). Runs when S3_TEST_ENDPOINT points at one: see
// docs/PRODUCT_PHOTOS_S3.md, «Локальная проверка».
const real = process.env.S3_TEST_ENDPOINT
  ? {
      accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? "",
      bucket: process.env.S3_TEST_BUCKET ?? "",
      endpoint: process.env.S3_TEST_ENDPOINT,
      forcePathStyle: true,
      region: process.env.S3_TEST_REGION ?? "ru-1",
      secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? "",
    } satisfies S3StorageSettings
  : null;

describe.skipIf(!real)("S3StorageProvider against an S3-compatible server", () => {
  it("stores, reads back and removes a photo", async () => {
    const provider = new S3StorageProvider(real!);
    const photo = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6]);

    const stored = await provider.store(photo, "jpg");
    try {
      expect((await provider.read(stored.storageKey)).equals(photo)).toBe(true);
      expect((await provider.open(stored.storageKey)).byteSize).toBe(photo.length);
    } finally {
      await provider.remove(stored.storageKey);
    }
    await expect(provider.read(stored.storageKey)).rejects.toThrow();
  });

  it("is refused with a wrong secret key", async () => {
    const provider = new S3StorageProvider({ ...real!, secretAccessKey: "wrong-secret-key-0000000000000000" });

    await expect(provider.store(Buffer.from("x"), "jpg")).rejects.toThrow();
  });
});
