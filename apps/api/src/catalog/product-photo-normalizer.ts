import { spawn } from "node:child_process";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/** The longest side of a stored product photo: enough for the card's zoom, a tenth of what a phone shoots. */
export const PRODUCT_PHOTO_MAX_SIDE = 1_600;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export class ProductPhotoNormalizeError extends Error {}

/**
 * The EXIF orientation of a JPEG (1–8), or 1 when the file names none. A phone stores the picture as the sensor saw
 * it and writes how it was held here; the ffmpeg in the API image does not apply it by itself.
 */
export function exifOrientation(content: Buffer): number {
  if (content.length < 4 || content.readUInt16BE(0) !== 0xffd8) return 1;
  let offset = 2;
  while (offset + 4 <= content.length) {
    if (content[offset] !== 0xff) return 1;
    const marker = content[offset + 1]!;
    // The picture itself starts here: no metadata follows.
    if (marker === 0xda || marker === 0xd9) return 1;
    const length = content.readUInt16BE(offset + 2);
    if (length < 2) return 1;
    const start = offset + 4;
    const end = offset + 2 + length;
    if (end > content.length) return 1;
    if (marker === 0xe1 && content.subarray(start, start + 6).toString("latin1") === "Exif\0\0") {
      return tiffOrientation(content.subarray(start + 6, end));
    }
    offset = end;
  }
  return 1;
}

function tiffOrientation(tiff: Buffer): number {
  if (tiff.length < 8) return 1;
  const order = tiff.toString("latin1", 0, 2);
  if (order !== "II" && order !== "MM") return 1;
  const little = order === "II";
  const u16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  if (u16(2) !== 42) return 1;
  const directory = u32(4);
  if (directory + 2 > tiff.length) return 1;
  const entries = u16(directory);
  for (let index = 0; index < entries; index += 1) {
    const entry = directory + 2 + index * 12;
    if (entry + 12 > tiff.length) return 1;
    if (u16(entry) !== 0x0112) continue;
    const value = u16(entry + 8);
    return value >= 1 && value <= 8 ? value : 1;
  }
  return 1;
}

/** ffmpeg filters that turn a picture stored with this EXIF orientation upright. */
const UPRIGHT: Record<number, string> = {
  2: "hflip,",
  3: "hflip,vflip,",
  4: "vflip,",
  5: "transpose=0,",
  6: "transpose=1,",
  7: "transpose=3,",
  8: "transpose=2,",
};

/**
 * One shape for every product photo, whoever shot it: upright, no larger than the card needs, on white where the
 * source was transparent, JPEG — and without the metadata a phone writes into a picture (where and when it was
 * taken, on what device), which has no business on a public site.
 */
@Injectable()
export class ProductPhotoNormalizer {
  private readonly binary: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.binary = config.get<string>("FFMPEG_PATH") ?? "ffmpeg";
    // A 50-megapixel phone picture is decoded and scaled here: twice what the validator is given to probe one.
    this.timeoutMs = (config.get<number>("MEDIA_PROBE_TIMEOUT_MS") ?? 10_000) * 2;
  }

  /** `content` has passed the malware scan and media validation: this only reshapes it. */
  normalize(content: Buffer): Promise<Buffer> {
    const side = PRODUCT_PHOTO_MAX_SIDE;
    const filter = `[0:v:0]${UPRIGHT[exifOrientation(content)] ?? ""}format=rgba,`
      + `scale=w='min(${side},iw)':h='min(${side},ih)':force_original_aspect_ratio=decrease:flags=lanczos,`
      + "split[picture][box];[box]drawbox=c=white:t=fill:replace=1[paper];"
      + "[paper][picture]overlay=format=auto,format=yuvj420p[out]";
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, [
        "-v", "error",
        "-nostdin",
        "-max_alloc", "268435456",
        "-threads", "1",
        "-filter_threads", "1",
        "-filter_complex_threads", "1",
        "-protocol_whitelist", "pipe",
        "-noautorotate",
        "-i", "pipe:0",
        "-filter_complex", filter,
        "-map", "[out]",
        "-frames:v", "1",
        "-map_metadata", "-1",
        "-q:v", "3",
        "-c:v", "mjpeg",
        "-f", "image2pipe",
        "pipe:1",
      ], {
        env: { LANG: "C", LC_ALL: "C", PATH: process.env.PATH ?? "/usr/bin:/bin" },
        shell: false,
        stdio: ["pipe", "pipe", "ignore"],
      });
      const chunks: Buffer[] = [];
      let bytes = 0;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(Buffer.concat(chunks));
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(new ProductPhotoNormalizeError("timeout"));
      }, this.timeoutMs);
      timer.unref();
      child.once("error", (error) => finish(new ProductPhotoNormalizeError("ffmpeg could not be started", { cause: error })));
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_OUTPUT_BYTES) {
          child.kill("SIGKILL");
          finish(new ProductPhotoNormalizeError("output too large"));
          return;
        }
        chunks.push(chunk);
      });
      child.once("close", (code) => {
        finish(code === 0 && bytes > 0 ? undefined : new ProductPhotoNormalizeError(`ffmpeg exited with ${code}`));
      });
      child.stdin.on("error", () => undefined);
      child.stdin.end(content);
    });
  }
}
