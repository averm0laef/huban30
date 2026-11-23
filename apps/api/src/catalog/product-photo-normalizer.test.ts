import { spawnSync } from "node:child_process";

import type { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";

import { exifOrientation, PRODUCT_PHOTO_MAX_SIDE, ProductPhotoNormalizer } from "./product-photo-normalizer.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0
  && spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;

function picture(args: string[]): Buffer {
  const made = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", ...args, "-frames:v", "1", "pipe:1"], { maxBuffer: 64 * 1024 * 1024 });
  if (made.status !== 0) throw new Error(made.stderr.toString());
  return made.stdout;
}

/** What a phone writes: the picture as the sensor saw it, plus «held this way», the maker and where it was taken. */
function withExif(jpeg: Buffer, orientation: number, order: "II" | "MM" = "II"): Buffer {
  const little = order === "II";
  const tiff = Buffer.alloc(8 + 2 + 24 + 4 + 12);
  const u16 = (value: number, at: number) => (little ? tiff.writeUInt16LE(value, at) : tiff.writeUInt16BE(value, at));
  const u32 = (value: number, at: number) => (little ? tiff.writeUInt32LE(value, at) : tiff.writeUInt32BE(value, at));
  tiff.write(order, 0, "latin1");
  u16(42, 2); u32(8, 4); u16(2, 8);
  u16(0x010f, 10); u16(2, 12); u32(12, 14); u32(38, 18); // Make → the text at the end
  u16(0x0112, 22); u16(3, 24); u32(1, 26); u16(orientation, 30); // Orientation
  tiff.write("PhoneMaker\0\0", 38, "latin1");
  const body = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xffe1, 0);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), head, body, jpeg.subarray(2)]);
}

function probe(content: Buffer): { height: number; width: number } {
  const out = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "json", "-i", "pipe:0"], { input: content });
  return (JSON.parse(out.stdout.toString()) as { streams: { height: number; width: number }[] }).streams[0]!;
}

/** The colour of one pixel of a JPEG, as [r, g, b]. */
function pixel(content: Buffer, x: number, y: number): number[] {
  const out = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-vf", `crop=2:2:${x}:${y},format=rgb24`, "-f", "rawvideo", "pipe:1"], { input: content });
  return [...out.stdout.subarray(0, 3)];
}

const normalizer = () => new ProductPhotoNormalizer({ get: () => undefined } as unknown as ConfigService);

describe("how a phone held the camera (EXIF orientation)", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x02, 0xff, 0xda]);

  it("is read in either byte order", () => {
    expect(exifOrientation(withExif(jpeg, 6, "II"))).toBe(6);
    expect(exifOrientation(withExif(jpeg, 8, "MM"))).toBe(8);
  });

  it("is «upright» for a file that names none, is not a JPEG, or is cut short", () => {
    expect(exifOrientation(jpeg)).toBe(1);
    expect(exifOrientation(Buffer.from("RIFF....WEBP"))).toBe(1);
    expect(exifOrientation(withExif(jpeg, 6).subarray(0, 20))).toBe(1);
    expect(exifOrientation(withExif(jpeg, 9))).toBe(1);
    expect(exifOrientation(Buffer.alloc(0))).toBe(1);
  });
});

describe.skipIf(!hasFfmpeg)("one shape for every product photo (real ffmpeg)", () => {
  it("turns a phone picture upright and removes what the phone wrote into it", async () => {
    // Left half red, right half blue, shot with the phone turned: stored 400×200, meant to be seen 200×400.
    const shot = withExif(picture(["-i", "color=c=red:s=200x200", "-f", "lavfi", "-i", "color=c=blue:s=200x200", "-filter_complex", "hstack", "-f", "mjpeg"]), 6);
    const stored = await normalizer().normalize(shot);
    expect(probe(stored)).toEqual({ height: 400, width: 200 });
    const [topRed, , topBlue] = pixel(stored, 100, 50);
    const [bottomRed, , bottomBlue] = pixel(stored, 100, 350);
    expect(topRed).toBeGreaterThan(200);
    expect(topBlue).toBeLessThan(60);
    expect(bottomBlue).toBeGreaterThan(200);
    expect(bottomRed).toBeLessThan(60);
    expect(stored.includes(Buffer.from("Exif"))).toBe(false);
    expect(stored.includes(Buffer.from("PhoneMaker"))).toBe(false);
    expect(stored.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  it("makes a large picture no larger than the card needs, keeping its proportions", async () => {
    const stored = await normalizer().normalize(picture(["-i", "color=c=gray:s=4000x3000", "-f", "mjpeg"]));
    expect(probe(stored)).toEqual({ height: PRODUCT_PHOTO_MAX_SIDE * 3 / 4, width: PRODUCT_PHOTO_MAX_SIDE });
  });

  it("leaves a small picture its size and puts a transparent one on white", async () => {
    const stored = await normalizer().normalize(picture(["-i", "color=c=black@0.0:s=300x200,format=rgba", "-f", "image2pipe", "-c:v", "png"]));
    expect(probe(stored)).toEqual({ height: 200, width: 300 });
    for (const channel of pixel(stored, 150, 100)) expect(channel).toBeGreaterThan(245);
  });

  it("refuses what is not a picture", async () => {
    await expect(normalizer().normalize(Buffer.from("not a picture at all"))).rejects.toThrow();
  });
});
