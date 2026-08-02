import { createDecipheriv, hkdfSync } from "node:crypto";

const ENCRYPTION_VERSION = 1;

export function decryptSecret(encoded: string, keyMaterial: string, purpose: string): string {
  const payload = Buffer.from(encoded, "base64url");
  if (payload.length < 30 || payload[0] !== ENCRYPTION_VERSION) {
    throw new Error("Unsupported encrypted outbox payload");
  }
  const key = Buffer.from(hkdfSync(
    "sha256",
    Buffer.from(keyMaterial, "utf8"),
    Buffer.from("an30-security-v1", "utf8"),
    Buffer.from("aes-256-gcm", "utf8"),
    32,
  ));
  const decipher = createDecipheriv("aes-256-gcm", key, payload.subarray(1, 13));
  decipher.setAAD(Buffer.from(purpose, "utf8"));
  decipher.setAuthTag(payload.subarray(13, 29));
  return Buffer.concat([decipher.update(payload.subarray(29)), decipher.final()]).toString("utf8");
}

