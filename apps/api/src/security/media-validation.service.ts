import { spawn } from "node:child_process";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";

const FFPROBE_OUTPUT_LIMIT_BYTES = 64 * 1024;
const MAX_IMAGE_PIXELS = 50_000_000;
const MAX_VIDEO_PIXELS = 35_500_000;
const MAX_VIDEO_DURATION_SECONDS = 120;

const ProbeSchema = z.object({
  format: z.object({
    duration: z.string().optional(),
    format_name: z.string(),
  }),
  streams: z.array(z.object({
    codec_name: z.string().optional(),
    codec_type: z.string(),
    duration: z.string().optional(),
    height: z.number().int().positive().optional(),
    width: z.number().int().positive().optional(),
  })),
});

type SupportedMimeType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "video/mp4"
  | "video/quicktime"
  | "video/webm";

export class InvalidMediaError extends Error {
  constructor(
    readonly reason: "dimensions" | "duration" | "invalid" | "timeout" = "invalid",
  ) {
    super(`Invalid media: ${reason}`);
    this.name = "InvalidMediaError";
  }
}

export class MediaValidatorUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MediaValidatorUnavailableError";
  }
}

@Injectable()
export class MediaValidationService {
  private readonly binary: string;
  private readonly decoderBinary: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.binary = config.get<string>("FFPROBE_PATH") ?? "ffprobe";
    this.decoderBinary = config.get<string>("FFMPEG_PATH") ?? "ffmpeg";
    this.timeoutMs = config.get<number>("MEDIA_PROBE_TIMEOUT_MS") ?? 10_000;
  }

  async assertValid(content: Buffer, mimeType: string): Promise<void> {
    const output = await this.probe(content);
    const parsed = ProbeSchema.safeParse(output);
    if (!parsed.success) throw new InvalidMediaError();

    const mime = mimeType as SupportedMimeType;
    const formatNames = new Set(parsed.data.format.format_name.split(","));
    const videoStream = parsed.data.streams.find((stream) => stream.codec_type === "video");
    if (!videoStream?.width || !videoStream.height) throw new InvalidMediaError();

    const expectedImage = mime.startsWith("image/");
    const validContainer = expectedImage
      ? this.validImageContainer(mime, formatNames, videoStream.codec_name)
      : this.validVideoContainer(mime, formatNames);
    if (!validContainer) throw new InvalidMediaError();

    const pixels = videoStream.width * videoStream.height;
    if (!Number.isSafeInteger(pixels) || pixels > (expectedImage ? MAX_IMAGE_PIXELS : MAX_VIDEO_PIXELS)) {
      throw new InvalidMediaError("dimensions");
    }

    if (!expectedImage) {
      const streamDuration = Number(videoStream.duration);
      const formatDuration = Number(parsed.data.format.duration);
      const duration = Number.isFinite(streamDuration) && streamDuration > 0
        ? streamDuration
        : formatDuration;
      if (!Number.isFinite(duration) || duration <= 0) throw new InvalidMediaError();
      if (duration > MAX_VIDEO_DURATION_SECONDS) throw new InvalidMediaError("duration");
    }

    await this.decode(content);
  }

  private async probe(content: Buffer): Promise<unknown> {
    const stdout = await this.execute(this.binary, [
      "-v", "error",
      "-max_alloc", "67108864",
      "-threads", "1",
      "-probesize", "4000000",
      "-analyzeduration", "4000000",
      "-protocol_whitelist", "pipe",
      "-show_entries", "format=format_name,duration:stream=codec_type,codec_name,width,height,duration",
      "-of", "json",
      "-i", "pipe:0",
    ], content);
    try {
      return JSON.parse(stdout.toString("utf8")) as unknown;
    } catch {
      throw new InvalidMediaError();
    }
  }

  private async decode(content: Buffer): Promise<void> {
    await this.execute(this.decoderBinary, [
      "-v", "error",
      "-xerror",
      "-err_detect", "explode",
      "-max_alloc", "67108864",
      "-threads", "1",
      "-filter_threads", "1",
      "-filter_complex_threads", "1",
      "-probesize", "4000000",
      "-analyzeduration", "4000000",
      "-protocol_whitelist", "pipe",
      "-i", "pipe:0",
      "-map", "0:v:0",
      "-an", "-sn", "-dn",
      "-f", "null",
      "-",
    ], content);
  }

  private execute(binary: string, args: string[], content: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn(binary, args, {
        env: {
          LANG: "C",
          LC_ALL: "C",
          PATH: process.env.PATH ?? "/usr/bin:/bin",
        },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let stderrBytes = 0;
      let settled = false;

      const finish = (error?: Error, value = Buffer.alloc(0)) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(new InvalidMediaError("timeout"));
      }, this.timeoutMs);
      timer.unref();

      child.once("error", (error) => {
        finish(new MediaValidatorUnavailableError("Media validation process could not be started", {
          cause: error,
        }));
      });
      child.stdout.on("data", (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > FFPROBE_OUTPUT_LIMIT_BYTES) {
          child.kill("SIGKILL");
          finish(new InvalidMediaError());
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes <= FFPROBE_OUTPUT_LIMIT_BYTES) stderr.push(chunk);
        if (stderrBytes > FFPROBE_OUTPUT_LIMIT_BYTES) {
          child.kill("SIGKILL");
          finish(new InvalidMediaError());
        }
      });
      child.once("close", (code) => {
        if (settled) return;
        if (code !== 0 || Buffer.concat(stderr).toString("utf8").trim().length > 0) {
          finish(new InvalidMediaError());
          return;
        }
        finish(undefined, Buffer.concat(stdout));
      });
      // ffprobe may reject malformed input before the whole buffer is written.
      // Handling EPIPE here prevents an untrusted file from becoming an
      // unhandled stream error in the API process.
      child.stdin.on("error", () => undefined);
      child.stdin.end(content);
    });
  }

  private validImageContainer(
    mimeType: SupportedMimeType,
    formats: ReadonlySet<string>,
    codec: string | undefined,
  ): boolean {
    if (mimeType === "image/jpeg") return formats.has("jpeg_pipe") && codec === "mjpeg";
    if (mimeType === "image/png") return formats.has("png_pipe") && codec === "png";
    if (mimeType === "image/webp") return formats.has("webp_pipe") && codec === "webp";
    return false;
  }

  private validVideoContainer(mimeType: SupportedMimeType, formats: ReadonlySet<string>): boolean {
    if (mimeType === "video/mp4" || mimeType === "video/quicktime") {
      return formats.has("mov") && formats.has("mp4");
    }
    return mimeType === "video/webm" && formats.has("webm");
  }
}
