import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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
    await expect(provider.read("../secret.txt")).rejects.toThrow(/Unsafe storage key/);
  });
});

