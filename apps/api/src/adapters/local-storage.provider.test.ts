import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";

import { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it } from "vitest";

import { LocalStorageProvider } from "./local-storage.provider.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))));

describe("LocalStorageProvider", () => {
  it("stores private files under an opaque key and rejects traversal", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "an30-storage-"));
    roots.push(root);
    const provider = new LocalStorageProvider(new ConfigService({ STORAGE_ROOT: root }));
    const stored = await provider.store(Buffer.from("safe"), "png");

    expect(stored.storageKey).toMatch(/^chat\/\d{4}-\d{2}\/[0-9a-f-]{36}\.png$/u);
    expect(await readFile(path.join(root, stored.storageKey), "utf8")).toBe("safe");
    const opened = await provider.open(stored.storageKey);
    const chunks: Buffer[] = [];
    opened.content.on("data", (chunk: Buffer) => chunks.push(chunk));
    await once(opened.content, "end");
    expect(opened.byteSize).toBe(4);
    expect(Buffer.concat(chunks).toString("utf8")).toBe("safe");
    await expect(provider.read("../secret.txt")).rejects.toThrow(/Unsafe storage key/);
    await expect(provider.open("../secret.txt")).rejects.toThrow(/Unsafe storage key/);
  });

  it("accepts only canonical catalog and content media namespaces", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "an30-storage-"));
    roots.push(root);
    const provider = new LocalStorageProvider(new ConfigService({ STORAGE_ROOT: root }));

    await expect(provider.read("catalog/2026-08/019bf9ea-0d3e-7def-8c9a-000000000010.png"))
      .rejects.toThrow(/ENOENT/u);
    await expect(provider.read("content/2026-08/019bf9ea-0d3e-7def-8c9a-000000000011.webp"))
      .rejects.toThrow(/ENOENT/u);
    await expect(provider.read("private/2026-08/019bf9ea-0d3e-7def-8c9a-000000000012.png"))
      .rejects.toThrow(/Unsafe storage key/u);
  });
});
