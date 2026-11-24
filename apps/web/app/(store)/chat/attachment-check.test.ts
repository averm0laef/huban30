import { describe, expect, it } from "vitest";

import { checkChatAttachment, formatSize } from "./attachment-check";

const MB = 1024 * 1024;

describe("a chat file checked before it is sent", () => {
  it("takes photos up to 5 MB and video up to 15 MB, as the server does", () => {
    expect(checkChatAttachment({ size: 4.9 * MB, type: "image/jpeg" })).toEqual({ kind: "image", ok: true });
    expect(checkChatAttachment({ size: 14 * MB, type: "video/quicktime" })).toEqual({ kind: "video", ok: true });
  });

  it("says why a file will not go, with its size, before any upload", () => {
    expect(checkChatAttachment({ size: 6.2 * MB, type: "image/png" })).toEqual({ message: "Фото больше 5 МБ (6,2 МБ). Уменьшите его или сделайте снимок заново.", ok: false });
    expect(checkChatAttachment({ size: 40 * MB, type: "video/mp4" })).toMatchObject({ ok: false, message: expect.stringContaining("40 МБ") });
    expect(checkChatAttachment({ size: 10_000, type: "application/pdf" })).toMatchObject({ ok: false, message: expect.stringContaining("JPG") });
  });

  it("writes a size the Russian way", () => {
    expect(formatSize(300)).toBe("1 КБ");
    expect(formatSize(2.4 * MB)).toBe("2,4 МБ");
    expect(formatSize(12.4 * MB)).toBe("12 МБ");
  });
});
