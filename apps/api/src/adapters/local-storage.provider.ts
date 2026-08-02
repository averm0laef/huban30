import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { StorageProvider, StoredObject } from "./provider-contracts.js";

const SAFE_STORAGE_KEY = /^(?:catalog|chat|content)\/[0-9]{4}-[0-9]{2}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/u;

@Injectable()
export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = path.resolve(config.getOrThrow<string>("STORAGE_ROOT"));
  }

  async store(content: Buffer, extension: string): Promise<StoredObject> {
    if (!/^[a-z0-9]{2,5}$/u.test(extension)) throw new Error("Unsafe storage extension");
    const month = new Date().toISOString().slice(0, 7);
    const storageKey = `chat/${month}/${randomUUID()}.${extension}`;
    const target = this.resolve(storageKey);
    await mkdir(path.dirname(target), { mode: 0o700, recursive: true });
    await writeFile(target, content, { flag: "wx", mode: 0o600 });
    return { byteSize: content.byteLength, storageKey };
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(this.resolve(storageKey));
  }

  async remove(storageKey: string): Promise<void> {
    await rm(this.resolve(storageKey), { force: true });
  }

  private resolve(storageKey: string): string {
    if (!SAFE_STORAGE_KEY.test(storageKey)) throw new Error("Unsafe storage key");
    const target = path.resolve(this.root, storageKey);
    if (!target.startsWith(`${this.root}${path.sep}`)) throw new Error("Storage path escaped root");
    return target;
  }
}
