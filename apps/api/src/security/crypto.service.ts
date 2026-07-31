import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

const ENCRYPTION_VERSION = 1;

@Injectable()
export class CryptoService {
  private readonly encryptionKey: Buffer;
  private readonly hmacKey: Buffer;

  constructor(config: ConfigService) {
    this.hmacKey = Buffer.from(config.getOrThrow<string>("SESSION_SECRET"), "utf8");
    this.encryptionKey = Buffer.from(hkdfSync(
      "sha256",
      Buffer.from(config.getOrThrow<string>("DATA_ENCRYPTION_KEY"), "utf8"),
      Buffer.from("an30-security-v1", "utf8"),
      Buffer.from("aes-256-gcm", "utf8"),
      32,
    ));
  }

  randomToken(byteLength = 32): string {
    return randomBytes(byteLength).toString("base64url");
  }

  opaqueHash(purpose: string, value: string): Buffer {
    return createHmac("sha256", this.hmacKey)
      .update(purpose, "utf8")
      .update("\0", "utf8")
      .update(value, "utf8")
      .digest();
  }

  opaqueHashMatches(purpose: string, value: string, expected: Buffer): boolean {
    const actual = this.opaqueHash(purpose, value);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  encrypt(value: string, purpose: string): Buffer {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, nonce);
    cipher.setAAD(Buffer.from(purpose, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([Buffer.from([ENCRYPTION_VERSION]), nonce, tag, ciphertext]);
  }

  decrypt(payload: Buffer, purpose: string): string {
    if (payload.length < 30 || payload[0] !== ENCRYPTION_VERSION) {
      throw new Error("Unsupported encrypted payload");
    }
    const nonce = payload.subarray(1, 13);
    const tag = payload.subarray(13, 29);
    const ciphertext = payload.subarray(29);
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, nonce);
    decipher.setAAD(Buffer.from(purpose, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }
}
