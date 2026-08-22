import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { ConfigService } from "@nestjs/config";
import { fileTypeFromBuffer } from "file-type";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  InvalidMediaError,
  MediaValidationService,
  MediaValidatorUnavailableError,
} from "./media-validation.service.js";

const roots: string[] = [];
let probePath = "";
const realMediaToolsAvailable = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0
  && spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;

beforeEach(async () => {
  const root = await mkdtemp(path.join(tmpdir(), "an30-ffprobe-"));
  roots.push(root);
  probePath = path.join(root, "fake-ffprobe");
  await writeFile(probePath, `#!/usr/bin/env node
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
if (option("-protocol_whitelist") !== "pipe" || option("-threads") !== "1" || !option("-max_alloc")) {
  process.exit(9);
}
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  const key = Buffer.concat(chunks).toString("utf8");
  const fixtures = {
    jpeg: { format: { format_name: "jpeg_pipe" }, streams: [{ codec_name: "mjpeg", codec_type: "video", width: 2, height: 2 }] },
    png: { format: { format_name: "png_pipe" }, streams: [{ codec_name: "png", codec_type: "video", width: 2, height: 2 }] },
    webp: { format: { format_name: "webp_pipe" }, streams: [{ codec_name: "webp", codec_type: "video", width: 2, height: 2 }] },
    mp4: { format: { duration: "1.000", format_name: "mov,mp4,m4a,3gp,3g2,mj2" }, streams: [{ codec_name: "h264", codec_type: "video", duration: "1.000", width: 16, height: 16 }] },
    mov: { format: { duration: "1.000", format_name: "mov,mp4,m4a,3gp,3g2,mj2" }, streams: [{ codec_name: "h264", codec_type: "video", duration: "1.000", width: 16, height: 16 }] },
    webm: { format: { duration: "1.000", format_name: "matroska,webm" }, streams: [{ codec_name: "vp9", codec_type: "video", duration: "N/A", width: 16, height: 16 }] },
    long: { format: { duration: "120.001", format_name: "mov,mp4,m4a,3gp,3g2,mj2" }, streams: [{ codec_name: "h264", codec_type: "video", duration: "120.001", width: 16, height: 16 }] },
    huge: { format: { format_name: "png_pipe" }, streams: [{ codec_name: "png", codec_type: "video", width: 50000, height: 50000 }] },
    stderr: { format: { duration: "1.000", format_name: "mov,mp4,m4a,3gp,3g2,mj2" }, streams: [{ codec_name: "h264", codec_type: "video", duration: "1.000", width: 16, height: 16 }] },
  };
  if (key === "invalid" || !fixtures[key]) process.exit(1);
  if (key === "stderr") process.stderr.write("decoder reported an integrity error");
  process.stdout.write(JSON.stringify(fixtures[key]));
});
`, { mode: 0o700 });
  await chmod(probePath, 0o700);
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

function validator(pathOverride = probePath) {
  return new MediaValidationService(new ConfigService({
    FFMPEG_PATH: pathOverride,
    FFPROBE_PATH: pathOverride,
    MEDIA_PROBE_TIMEOUT_MS: 10_000,
  }));
}

describe("MediaValidationService", () => {
  it.each([
    ["jpeg", "image/jpeg"],
    ["png", "image/png"],
    ["webp", "image/webp"],
    ["mp4", "video/mp4"],
    ["mov", "video/quicktime"],
    ["webm", "video/webm"],
  ])("accepts a structurally valid %s probe only for its declared type", async (fixture, mimeType) => {
    await expect(validator().assertValid(Buffer.from(fixture), mimeType)).resolves.toBeUndefined();
  });

  it("rejects truncated/unparseable media, excessive dimensions, and videos over two minutes", async () => {
    await expect(validator().assertValid(Buffer.from("invalid"), "video/mp4"))
      .rejects.toMatchObject({ reason: "invalid" });
    await expect(validator().assertValid(Buffer.from("huge"), "image/png"))
      .rejects.toMatchObject({ reason: "dimensions" });
    await expect(validator().assertValid(Buffer.from("long"), "video/mp4"))
      .rejects.toMatchObject({ reason: "duration" });
    await expect(validator().assertValid(Buffer.from("stderr"), "video/mp4"))
      .rejects.toMatchObject({ reason: "invalid" });
  });

  it("fails closed when the isolated probe executable is unavailable", async () => {
    await expect(validator("/definitely/missing/an30-ffprobe").assertValid(Buffer.from("mp4"), "video/mp4"))
      .rejects.toBeInstanceOf(MediaValidatorUnavailableError);
  });

  it("uses typed validation failures", () => {
    expect(new InvalidMediaError()).toBeInstanceOf(Error);
  });

  it.runIf(realMediaToolsAvailable)(
    "accepts real decodable fixtures for every allowed format and rejects truncated MP4/JPEG",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "an30-real-media-"));
      roots.push(root);
      const movPath = path.join(root, "valid.mov");
      const mp4Path = path.join(root, "valid.mp4");
      const jpegPath = path.join(root, "valid.jpg");
      const pngPath = path.join(root, "valid.png");
      const webmPath = path.join(root, "valid.webm");
      const mp4 = spawnSync("ffmpeg", [
        "-v", "error", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=32x32:r=10:d=0.6",
        "-an", "-c:v", "libx264", "-profile:v", "baseline", "-pix_fmt", "yuv420p",
        mp4Path,
      ]);
      const jpeg = spawnSync("ffmpeg", [
        "-v", "error", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=32x32",
        "-frames:v", "1", jpegPath,
      ]);
      const png = spawnSync("ffmpeg", [
        "-v", "error", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=32x32",
        "-frames:v", "1", pngPath,
      ]);
      const mov = spawnSync("ffmpeg", [
        "-v", "error", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=32x32:r=10:d=0.6",
        "-an", "-c:v", "mpeg4", "-pix_fmt", "yuv420p", "-f", "mov", movPath,
      ]);
      const webm = spawnSync("ffmpeg", [
        "-v", "error", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=32x32:r=10:d=0.6",
        "-an", "-c:v", "libvpx-vp9", "-f", "webm", webmPath,
      ]);
      expect(mp4.status).toBe(0);
      expect(jpeg.status).toBe(0);
      expect(png.status).toBe(0);
      expect(mov.status).toBe(0);
      expect(webm.status).toBe(0);
      const validMp4 = await readFile(mp4Path);
      const validJpeg = await readFile(jpegPath);
      const validPng = await readFile(pngPath);
      const validMov = await readFile(movPath);
      const validWebm = await readFile(webmPath);
      const validWebp = Buffer.from(
        "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEALmk0mk0iIiIiIgBoSygABc6zbAAA",
        "base64",
      );
      const realValidator = new MediaValidationService(new ConfigService({
        FFMPEG_PATH: "ffmpeg",
        FFPROBE_PATH: "ffprobe",
        MEDIA_PROBE_TIMEOUT_MS: 10_000,
      }));

      await expect(fileTypeFromBuffer(validJpeg)).resolves.toMatchObject({ mime: "image/jpeg" });
      await expect(fileTypeFromBuffer(validPng)).resolves.toMatchObject({ mime: "image/png" });
      await expect(fileTypeFromBuffer(validWebp)).resolves.toMatchObject({ mime: "image/webp" });
      await expect(fileTypeFromBuffer(validMp4)).resolves.toMatchObject({ mime: "video/mp4" });
      await expect(fileTypeFromBuffer(validMov)).resolves.toMatchObject({ mime: "video/quicktime" });
      await expect(fileTypeFromBuffer(validWebm)).resolves.toMatchObject({ mime: "video/webm" });

      await expect(realValidator.assertValid(validMp4, "video/mp4")).resolves.toBeUndefined();
      await expect(realValidator.assertValid(validMov, "video/quicktime")).resolves.toBeUndefined();
      await expect(realValidator.assertValid(validWebm, "video/webm")).resolves.toBeUndefined();
      await expect(realValidator.assertValid(validJpeg, "image/jpeg")).resolves.toBeUndefined();
      await expect(realValidator.assertValid(validPng, "image/png")).resolves.toBeUndefined();
      await expect(realValidator.assertValid(validWebp, "image/webp")).resolves.toBeUndefined();
      await expect(realValidator.assertValid(validMp4.subarray(0, validMp4.length - 128), "video/mp4"))
        .rejects.toBeInstanceOf(InvalidMediaError);
      await expect(realValidator.assertValid(validJpeg.subarray(0, Math.floor(validJpeg.length / 2)), "image/jpeg"))
        .rejects.toBeInstanceOf(InvalidMediaError);
    },
    30_000,
  );

  it.runIf(realMediaToolsAvailable)(
    "does not let a media playlist fetch an external HTTP reference",
    async () => {
      let requests = 0;
      const server = createHttpServer((_request, response) => {
        requests += 1;
        response.end("must-not-be-read");
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("HTTP fixture did not bind");
      const playlist = Buffer.from([
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        "#EXT-X-TARGETDURATION:1",
        "#EXTINF:1.0,",
        `http://127.0.0.1:${address.port}/secret.ts`,
        "#EXT-X-ENDLIST",
      ].join("\n"));
      const realValidator = new MediaValidationService(new ConfigService({
        FFMPEG_PATH: "ffmpeg",
        FFPROBE_PATH: "ffprobe",
        MEDIA_PROBE_TIMEOUT_MS: 10_000,
      }));
      try {
        await expect(realValidator.assertValid(playlist, "video/mp4"))
          .rejects.toBeInstanceOf(InvalidMediaError);
        expect(requests).toBe(0);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
    20_000,
  );
});
