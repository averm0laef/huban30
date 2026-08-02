import { describe, expect, it } from "vitest";

import { etagMatches, withPublicMediaRead } from "./public-media.js";

describe("public media guard", () => {
  it("matches weak and comma-separated validators", () => {
    expect(etagMatches('"old", W/"sha256-current"', '"sha256-current"')).toBe(true);
    expect(etagMatches('"other"', '"sha256-current"')).toBe(false);
  });

  it("rejects reads above the process-wide concurrency budget", async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const reads = Array.from({ length: 8 }, () => withPublicMediaRead(async () => barrier));
    await expect(withPublicMediaRead(async () => "overflow")).rejects.toThrow(
      "Сервис изображений временно занят",
    );
    release();
    await Promise.all(reads);
    await expect(withPublicMediaRead(async () => "available")).resolves.toBe("available");
  });
});
