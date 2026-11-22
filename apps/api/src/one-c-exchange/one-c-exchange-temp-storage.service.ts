// Temp storage for the raw files 1C uploads in chunks before mode=import
// parses them (see one-c-exchange.controller.ts and the CommerceML protocol
// notes in packages/contracts/src/one-c-exchange.ts). Deliberately separate
// from LocalStorageProvider (adapters/local-storage.provider.ts): that
// provider serves permanent, content-addressed catalog/chat media, this is a
// scratch area for one in-flight exchange, keyed by the 1C-supplied relative
// path and purged at the start of every session (mode=init).
//
// Uploads keep only the current request chunk in memory and append it to disk.

import { mkdir, open, opendir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { sourceSql, type OneCSource } from "./one-c-source.js";

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
const MAX_INCOMING_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_INCOMING_FILES = 100_000;
const MAX_PENDING_UPLOADS = 4;

export class OneCStorageLimitError extends Error {}

interface StorageUsage {
  bytes: number;
  files: number;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

@Injectable()
export class OneCExchangeTempStorageService {
  private readonly root: string;
  private readonly usageBySource = new Map<OneCSource, StorageUsage>();
  private readonly mutations = new Map<OneCSource, Promise<void>>();
  private readonly pendingUploads = new Map<OneCSource, number>();

  constructor(config: ConfigService) {
    this.root = path.resolve(config.getOrThrow<string>("STORAGE_ROOT"), "one-c-exchange", "incoming");
  }

  /**
   * Appends one chunk to the target file, creating parent directories as
   * needed. The CommerceML exchange protocol carries neither a chunk offset
   * nor a sequence/idempotency key, so byte content cannot tell a retry from
   * two legitimate adjacent equal chunks. Every successful mode=file request
   * is therefore one append; guessing from a matching tail would silently
   * corrupt valid XML (for example across a repeated padding/text boundary).
   */
  async appendChunk(relativePath: string, chunk: Buffer, source: OneCSource = "one_c"): Promise<void> {
    const target = this.resolve(relativePath,source);
    if (chunk.length === 0) throw new Error("Empty 1C exchange chunk");
    const pending = this.pendingUploads.get(source) ?? 0;
    if (pending >= MAX_PENDING_UPLOADS) throw new OneCStorageLimitError("Хранилище обмена 1С занято, повторите загрузку");
    this.pendingUploads.set(source, pending + 1);
    try {
      await this.mutate(source, () => this.writeChunk(target, chunk, source));
    } finally {
      const remaining = (this.pendingUploads.get(source) ?? 1) - 1;
      if (remaining === 0) this.pendingUploads.delete(source);
      else this.pendingUploads.set(source, remaining);
    }
  }

  private async writeChunk(target: string, chunk: Buffer, source: OneCSource): Promise<void> {
    const usage = await this.usage(source);
    const previousSize = await this.fileSize(target);
    if ((previousSize ?? 0) + chunk.length > MAX_ASSEMBLED_BYTES) {
      throw new OneCStorageLimitError("Превышен допустимый размер файла обмена 1С");
    }
    if (usage.bytes + chunk.length > MAX_INCOMING_BYTES || (previousSize === null && usage.files >= MAX_INCOMING_FILES)) {
      throw new OneCStorageLimitError("Превышена квота временного хранилища 1С");
    }

    try {
      await mkdir(path.dirname(target), { mode: 0o700, recursive: true });
      const handle = await open(target, "a", 0o600);
      try {
        await handle.appendFile(chunk);
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      // A failed write may have added some bytes. Recount before the next write.
      this.usageBySource.delete(source);
      throw error;
    }
    usage.bytes += chunk.length;
    if (previousSize === null) usage.files += 1;
  }

  async readAssembled(relativePath: string, source: OneCSource = "one_c", maxBytes = MAX_ASSEMBLED_BYTES): Promise<Buffer> {
    const handle = await open(this.resolve(relativePath, source), "r");
    try {
      const { size } = await handle.stat();
      if (size > maxBytes) throw new RangeError("Assembled 1C exchange file exceeds the size limit");
      const content = Buffer.alloc(size);
      let offset = 0;
      while (offset < size) {
        const { bytesRead } = await handle.read(content, offset, size - offset, offset);
        if (bytesRead === 0) throw new Error("Assembled 1C exchange file changed during the read");
        offset += bytesRead;
      }
      return content;
    } finally {
      await handle.close();
    }
  }

  /** Removes one assembled/partial file, e.g. once mode=import has fully consumed it. */
  async remove(relativePath: string, source: OneCSource = "one_c"): Promise<void> {
    const target = this.resolve(relativePath, source);
    await this.mutate(source, async () => {
      const usage = this.usageBySource.get(source);
      const size = usage ? await this.fileSize(target) : null;
      await rm(target, { force: true });
      if (usage && size !== null) {
        usage.bytes -= size;
        usage.files -= 1;
      }
    });
  }

  /** Clears every in-flight upload. Called on mode=init, which always starts a fresh exchange session. */
  async purgeAll(source: OneCSource = "one_c"): Promise<void> {
    sourceSql(source);
    await this.mutate(source, async () => {
      this.usageBySource.delete(source);
      await rm(path.join(this.root, source), { force: true, recursive: true });
      this.usageBySource.set(source, { bytes: 0, files: 0 });
    });
  }

  private async mutate(source: OneCSource, operation: () => Promise<void>): Promise<void> {
    const mutation = (this.mutations.get(source) ?? Promise.resolve()).then(operation);
    const tail = mutation.catch(() => undefined);
    this.mutations.set(source, tail);
    try {
      await mutation;
    } finally {
      if (this.mutations.get(source) === tail) this.mutations.delete(source);
    }
  }

  private async usage(source: OneCSource): Promise<StorageUsage> {
    const cached = this.usageBySource.get(source);
    if (cached) return cached;

    const usage = { bytes: 0, files: 0 };
    const directories = [path.join(this.root, source)];
    for (const directory of directories) {
      const handle = await opendir(directory).catch((error: unknown) => {
        if (isMissing(error)) return null;
        throw error;
      });
      if (!handle) continue;
      for await (const entry of handle) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) directories.push(target);
        if (entry.isFile()) {
          const size = await this.fileSize(target);
          if (size !== null) {
            usage.bytes += size;
            usage.files += 1;
          }
        }
      }
    }
    this.usageBySource.set(source, usage);
    return usage;
  }

  private async fileSize(target: string): Promise<number | null> {
    try {
      const info = await stat(target);
      if (!info.isFile()) throw new Error("Invalid 1C exchange file");
      return info.size;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  private resolve(relativePath: string, source: OneCSource): string {
    sourceSql(source);
    if (!SAFE_RELATIVE_PATH.test(relativePath) || relativePath.includes("..")) {
      throw new Error("Unsafe 1C exchange filename");
    }
    const root = path.join(this.root,source);
    const target = path.resolve(root, relativePath);
    if (!target.startsWith(`${root}${path.sep}`)) {
      throw new Error("1C exchange filename escaped the storage root");
    }
    return target;
  }
}
