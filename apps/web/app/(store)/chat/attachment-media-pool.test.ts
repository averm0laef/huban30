import { describe, expect, it, vi } from "vitest";

import {
  ActiveVideoRegistry,
  AttachmentFetchScheduler,
  AttachmentImageCache,
  ImagePreviewCapacityError,
  imagePreviewLoadingMode,
} from "./attachment-media-pool";

function fakeSource() {
  let counter = 0;
  return {
    createObjectURL: vi.fn(() => `blob:cached-${counter++}`),
    revokeObjectURL: vi.fn(),
  };
}

describe("AttachmentFetchScheduler", () => {
  it("uses explicit manual image loading when IntersectionObserver is unavailable", () => {
    expect(imagePreviewLoadingMode(false)).toBe("manual");
    expect(imagePreviewLoadingMode(true)).toBe("intersection");
  });

  it("never runs more than three image responses concurrently", async () => {
    const scheduler = new AttachmentFetchScheduler(3);
    const releases: Array<() => void> = [];
    let running = 0;
    let maximum = 0;
    const jobs = Array.from({ length: 7 }, (_, index) => scheduler.schedule(() => new Promise<number>((resolve) => {
      running += 1;
      maximum = Math.max(maximum, running);
      releases.push(() => {
        running -= 1;
        resolve(index);
      });
    })));

    expect(releases).toHaveLength(3);
    releases.shift()!();
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    while (releases.length > 0) {
      releases.shift()!();
      await Promise.resolve();
    }
    await Promise.all(jobs.map((job) => job.promise));
    expect(maximum).toBe(3);
    expect(scheduler.activeCount).toBe(0);
    expect(scheduler.pendingCount).toBe(0);
  });

  it("cancels an offscreen queued image before its fetch starts", async () => {
    const scheduler = new AttachmentFetchScheduler(1);
    let releaseFirst!: () => void;
    const first = scheduler.schedule(() => new Promise<void>((resolve) => { releaseFirst = resolve; }));
    const secondTask = vi.fn(async () => "second");
    const second = scheduler.schedule(secondTask);
    const rejected = expect(second.promise).rejects.toMatchObject({ name: "AbortError" });

    second.cancel();
    releaseFirst();
    await first.promise;
    await rejected;
    expect(secondTask).not.toHaveBeenCalled();
  });
});

describe("AttachmentImageCache", () => {
  it("reuses a released image without another object URL and evicts the idle LRU", () => {
    const source = fakeSource();
    const cache = new AttachmentImageCache(source, 2, 10);
    const first = cache.insertAndAcquire("a", new Blob(["aaaa"]));
    first.release();
    const second = cache.insertAndAcquire("b", new Blob(["bbbb"]));
    second.release();
    const reused = cache.acquire("a");
    expect(reused?.url).toBe(first.url);
    reused?.release();
    const third = cache.insertAndAcquire("c", new Blob(["cccc"]));

    expect(source.createObjectURL).toHaveBeenCalledTimes(3);
    expect(source.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(source.revokeObjectURL).toHaveBeenCalledWith(second.url);
    expect(cache.size).toBe(2);
    expect(cache.byteSize).toBe(8);
    third.release();
    cache.clear();
  });

  it("keeps the hard bound when every cached image is currently visible", () => {
    const source = fakeSource();
    const cache = new AttachmentImageCache(source, 1, 5);
    const visible = cache.insertAndAcquire("visible", new Blob(["aaaa"]));

    expect(() => cache.insertAndAcquire("next", new Blob(["b"]))).toThrow(ImagePreviewCapacityError);
    expect(cache.size).toBe(1);
    expect(source.createObjectURL).toHaveBeenCalledTimes(1);
    visible.release();
    const next = cache.insertAndAcquire("next", new Blob(["b"]));
    expect(source.revokeObjectURL).toHaveBeenCalledWith(visible.url);
    next.release();
    cache.clear();
  });
});

describe("ActiveVideoRegistry", () => {
  it("aborts and revokes the previous video when another is explicitly loaded", () => {
    const registry = new ActiveVideoRegistry();
    const revokeFirst = vi.fn();
    const first = registry.claim(revokeFirst);
    const second = registry.claim(vi.fn());

    expect(first.signal.aborted).toBe(true);
    expect(first.isCurrent()).toBe(false);
    expect(revokeFirst).toHaveBeenCalledTimes(1);
    expect(second.signal.aborted).toBe(false);
    second.release();
    expect(second.signal.aborted).toBe(true);
  });
});
