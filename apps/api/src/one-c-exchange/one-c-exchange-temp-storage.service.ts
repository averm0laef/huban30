// Temp storage for the raw files 1C uploads in chunks before mode=import
// parses them (see one-c-exchange.controller.ts and the CommerceML protocol
// notes in packages/contracts/src/one-c-exchange.ts). Deliberately separate
// from LocalStorageProvider (adapters/local-storage.provider.ts): that
// provider serves permanent, content-addressed catalog/chat media, this is a
// scratch area for one in-flight exchange, keyed by the 1C-supplied relative
// path and purged at the start of every session (mode=init).
//
// Each chunk is streamed straight to disk with fs.appendFile — the request
// handler never buffers more than one chunk (already capped well under
// Fastify's body limit) in memory, so total memory use does not grow with
// the assembled file size even for a multi-hundred-megabyte catalog export.

import { createHash } from "node:crypto";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

// Mirrors OneCExchangeQuerySchema's filename allowlist in
// packages/contracts/src/one-c-exchange.ts. Re-checked here rather than
// trusted from the transport layer: this is the boundary that actually
// touches the filesystem.
const SAFE_RELATIVE_PATH = /^[A-Za-z0-9._/-]+$/u;

// Generous but bounded: a 30-40k SKU catalog's import.xml/offers.xml is
// expected to be tens of megabytes, not hundreds, but this only exists to
// stop a runaway or hostile upload from filling the disk — not to model a
// realistic file size.
const MAX_ASSEMBLED_BYTES = 512 * 1024 * 1024;

@Injectable()
export class OneCExchangeTempStorageService {
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = path.resolve(config.getOrThrow<string>("STORAGE_ROOT"), "one-c-exchange", "incoming");
  }

  /**
   * Appends one chunk to the target file, creating parent directories as
   * needed. If the file already ends with exactly these bytes (a resumed or
   * repeated chunk — 1C has no way to tell us "you already have this"), the
   * append is skipped so the file is never duplicated in place.
   */
  async appendChunk(relativePath: string, chunk: Buffer): Promise<void> {
    const target = this.resolve(relativePath);
    await mkdir(path.dirname(target), { mode: 0o700, recursive: true });

    // -1 marks "no file yet", which is why this is not initialised to 0: a
    // zero-length file and a missing one must take different branches below.
    let currentSize: number;
    try {
      currentSize = (await stat(target)).size;
    } catch {
      currentSize = -1;
    }

    if (currentSize >= 0 && chunk.length > 0 && currentSize >= chunk.length) {
      const handle = await open(target, "r");
      try {
        const tail = Buffer.alloc(chunk.length);
        await handle.read(tail, 0, chunk.length, currentSize - chunk.length);
        if (tail.equals(chunk)) return; // exact repeat of the last chunk: already durable, do not duplicate it
      } finally {
        await handle.close();
      }
    }

    if (currentSize > 0 && currentSize + chunk.length > MAX_ASSEMBLED_BYTES) {
      throw new Error("Assembled 1C exchange file exceeds the size limit");
    }

    const handle = await open(target, "a", 0o600);
    try {
      await handle.appendFile(chunk);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  /** Reads the fully assembled file. Only called once, by mode=import, after every chunk has been appended. */
  async readAssembled(relativePath: string): Promise<Buffer> {
    return readFile(this.resolve(relativePath));
  }

  /** SHA-256 of the assembled file, used to key an idempotent, resumable exchange run. */
  async checksum(relativePath: string): Promise<Buffer> {
    return createHash("sha256").update(await this.readAssembled(relativePath)).digest();
  }

  /** Removes one assembled/partial file, e.g. once mode=import has fully consumed it. */
  async remove(relativePath: string): Promise<void> {
    await rm(this.resolve(relativePath), { force: true });
  }

  /** Clears every in-flight upload. Called on mode=init, which always starts a fresh exchange session. */
  async purgeAll(): Promise<void> {
    await rm(this.root, { force: true, recursive: true });
  }

  private resolve(relativePath: string): string {
    if (!SAFE_RELATIVE_PATH.test(relativePath) || relativePath.includes("..")) {
      throw new Error("Unsafe 1C exchange filename");
    }
    const target = path.resolve(this.root, relativePath);
    if (target !== this.root && !target.startsWith(`${this.root}${path.sep}`)) {
      throw new Error("1C exchange filename escaped the storage root");
    }
    return target;
  }
}
