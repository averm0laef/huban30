import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { Injectable } from "@nestjs/common";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_PERIOD_SECONDS = 30;

function encodeBase32(value: Buffer): string {
  let bits = 0;
  let accumulator = 0;
  let output = "";
  for (const byte of value) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(accumulator >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(accumulator << (5 - bits)) & 31];
  return output;
}

function decodeBase32(value: string): Buffer {
  let bits = 0;
  let accumulator = 0;
  const output: number[] = [];
  for (const character of value.replace(/=+$/u, "").toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 secret");
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function codeAt(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", secret).update(counter).digest();
  const offset = (digest.at(-1) ?? 0) & 15;
  const value = (digest.readUInt32BE(offset) & 0x7fff_ffff) % 1_000_000;
  return value.toString().padStart(6, "0");
}

@Injectable()
export class TotpService {
  generateSecret(): string {
    return encodeBase32(randomBytes(20));
  }

  provisioningUri(secret: string, accountEmail: string): string {
    const label = encodeURIComponent(`АН-30:${accountEmail}`);
    return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent("АН-30")}&algorithm=SHA1&digits=6&period=${TOTP_PERIOD_SECONDS}`;
  }

  generateCode(secret: string, now = Date.now()): string {
    const step = Math.floor(now / 1_000 / TOTP_PERIOD_SECONDS);
    return codeAt(decodeBase32(secret), step);
  }

  verify(secret: string, code: string, now = Date.now()): number | null {
    if (!/^\d{6}$/u.test(code)) return null;
    const key = decodeBase32(secret);
    const currentStep = Math.floor(now / 1_000 / TOTP_PERIOD_SECONDS);
    const supplied = Buffer.from(code, "utf8");
    for (const offset of [-1, 0, 1]) {
      const step = currentStep + offset;
      const expected = Buffer.from(codeAt(key, step), "utf8");
      if (timingSafeEqual(supplied, expected)) return step;
    }
    return null;
  }

  generateRecoveryCodes(count = 10): string[] {
    return Array.from({ length: count }, () => {
      const value = encodeBase32(randomBytes(8));
      return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`;
    });
  }
}
