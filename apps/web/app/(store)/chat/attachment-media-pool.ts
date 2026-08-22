import type { BlobUrlSource } from "./attachment-object-url";

/** At most three image responses may be in flight across /chat and the widget. */
export const IMAGE_FETCH_CONCURRENCY = 3;
/** Eight verified images at the server-side 5 MiB limit cap retained blob memory at 40 MiB. */
export const IMAGE_CACHE_ENTRIES = 8;
export const IMAGE_CACHE_BYTES = 40 * 1024 * 1024;

export function imagePreviewLoadingMode(intersectionObserverAvailable: boolean): "intersection" | "manual" {
  return intersectionObserverAvailable ? "intersection" : "manual";
}

interface QueueItem {
  cancelled: boolean;
  controller: AbortController;
  reject: (reason: unknown) => void;
  run: () => void;
  started: boolean;
}

export interface ScheduledFetch<T> {
  cancel: () => void;
  promise: Promise<T>;
}

function abortError(): DOMException {
  return new DOMException("Attachment preview cancelled", "AbortError");
}

/**
 * Small FIFO scheduler used for image previews. Cancellation removes queued
 * work before it reaches fetch and aborts an in-flight response when an image
 * leaves the scroll root. It deliberately has no React dependency so its
 * concurrency guarantee is unit-testable.
 */
export class AttachmentFetchScheduler {
  private active = 0;
  private readonly waiting: QueueItem[] = [];

  constructor(private readonly concurrency = IMAGE_FETCH_CONCURRENCY) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
      throw new Error("Attachment fetch concurrency must be a positive integer");
    }
  }

  get activeCount(): number { return this.active; }
  get pendingCount(): number { return this.waiting.filter((item) => !item.cancelled).length; }

  schedule<T>(task: (signal: AbortSignal) => Promise<T>): ScheduledFetch<T> {
    const controller = new AbortController();
    let settled = false;
    let item!: QueueItem;
    const promise = new Promise<T>((resolve, reject) => {
      item = {
        cancelled: false,
        controller,
        reject,
        run: () => {
          if (item.cancelled) return;
          item.started = true;
          this.active += 1;
          void task(controller.signal)
            .then((value) => {
              if (item.cancelled) reject(abortError());
              else resolve(value);
            }, reject)
            .finally(() => {
              settled = true;
              this.active -= 1;
              this.drain();
            });
        },
        started: false,
      };
      this.waiting.push(item);
      this.drain();
    });
    return {
      cancel: () => {
        if (settled || item.cancelled) return;
        item.cancelled = true;
        controller.abort();
        if (item.started) return;
        const index = this.waiting.indexOf(item);
        if (index >= 0) this.waiting.splice(index, 1);
        settled = true;
        item.reject(abortError());
        this.drain();
      },
      promise,
    };
  }

  private drain(): void {
    while (this.active < this.concurrency) {
      const item = this.waiting.shift();
      if (!item) return;
      if (item.cancelled) {
        item.reject(abortError());
        continue;
      }
      item.run();
    }
  }
}

interface CacheEntry {
  byteSize: number;
  holders: number;
  lastUsed: number;
  url: string;
}

export interface ImageCacheLease {
  release: () => void;
  url: string;
}

/** Raised only when every one of the eight bounded cache entries is on screen. */
export class ImagePreviewCapacityError extends Error {
  constructor() {
    super("Слишком много изображений открыто одновременно. Прокрутите чат и повторите");
    this.name = "ImagePreviewCapacityError";
  }
}

/**
 * Shared eight-entry LRU of image object URLs. Idle entries are retained so a
 * short scroll back does not issue another GET, while insertion always evicts
 * and revokes enough idle URLs to stay under both the entry and byte limits.
 */
export class AttachmentImageCache {
  private readonly entries = new Map<string, CacheEntry>();
  private clock = 0;
  private totalBytes = 0;

  constructor(
    private readonly source: BlobUrlSource = URL,
    private readonly maxEntries = IMAGE_CACHE_ENTRIES,
    private readonly maxBytes = IMAGE_CACHE_BYTES,
  ) {}

  get byteSize(): number { return this.totalBytes; }
  get size(): number { return this.entries.size; }

  acquire(key: string): ImageCacheLease | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    entry.holders += 1;
    entry.lastUsed = ++this.clock;
    return this.lease(key, entry);
  }

  insertAndAcquire(key: string, blob: Blob): ImageCacheLease {
    const existing = this.acquire(key);
    if (existing) return existing;
    if (blob.size > this.maxBytes) throw new ImagePreviewCapacityError();
    while (this.entries.size >= this.maxEntries || this.totalBytes + blob.size > this.maxBytes) {
      const candidate = [...this.entries.entries()]
        .filter(([, entry]) => entry.holders === 0)
        .sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0];
      if (!candidate) throw new ImagePreviewCapacityError();
      this.evict(candidate[0], candidate[1]);
    }
    const entry: CacheEntry = {
      byteSize: blob.size,
      holders: 1,
      lastUsed: ++this.clock,
      url: this.source.createObjectURL(blob),
    };
    this.entries.set(key, entry);
    this.totalBytes += entry.byteSize;
    return this.lease(key, entry);
  }

  clear(): void {
    for (const [key, entry] of this.entries) this.evict(key, entry);
  }

  /** Removes a corrupt/undecodable cached image after its sole holder releases it. */
  discard(key: string): void {
    const entry = this.entries.get(key);
    if (entry && entry.holders === 0) this.evict(key, entry);
  }

  private evict(key: string, entry: CacheEntry): void {
    this.entries.delete(key);
    this.totalBytes -= entry.byteSize;
    this.source.revokeObjectURL(entry.url);
  }

  private lease(key: string, entry: CacheEntry): ImageCacheLease {
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        const current = this.entries.get(key);
        if (current !== entry) return;
        current.holders = Math.max(0, current.holders - 1);
        current.lastUsed = ++this.clock;
      },
      url: entry.url,
    };
  }
}

export interface ActiveVideoClaim {
  isCurrent: () => boolean;
  release: () => void;
  signal: AbortSignal;
}

/**
 * Only one downloaded video is allowed globally. Claiming another video
 * aborts the previous request and asks its component to revoke the blob URL.
 */
export class ActiveVideoRegistry {
  private active: { controller: AbortController; onRevoke: () => void; token: symbol } | null = null;

  claim(onRevoke: () => void): ActiveVideoClaim {
    if (this.active) {
      this.active.controller.abort();
      this.active.onRevoke();
    }
    const controller = new AbortController();
    const token = Symbol("active-video");
    this.active = { controller, onRevoke, token };
    return {
      isCurrent: () => this.active?.token === token,
      release: () => {
        if (this.active?.token !== token) return;
        controller.abort();
        this.active = null;
      },
      signal: controller.signal,
    };
  }
}

export const attachmentFetchScheduler = new AttachmentFetchScheduler();
export const attachmentImageCache = new AttachmentImageCache();
export const activeVideoRegistry = new ActiveVideoRegistry();
