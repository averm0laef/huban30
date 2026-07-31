import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

import { Injectable } from "@nestjs/common";

const ARGON2_MEMORY_KIB = 65_536;
const ARGON2_PARALLELISM = 4;
const ARGON2_PASSES = 3;
const ARGON2_TAG_LENGTH = 32;
const ARGON2_VERSION = 19;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2("argon2id", {
      memory: ARGON2_MEMORY_KIB,
      message: Buffer.from(password, "utf8"),
      nonce: salt,
      parallelism: ARGON2_PARALLELISM,
      passes: ARGON2_PASSES,
      tagLength: ARGON2_TAG_LENGTH,
    }, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

@Injectable()
export class PasswordService {
  private dummyHash?: Promise<string>;

  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const result = await derive(password, salt);
    return [
      "$argon2id",
      `v=${ARGON2_VERSION}`,
      `m=${ARGON2_MEMORY_KIB},t=${ARGON2_PASSES},p=${ARGON2_PARALLELISM}`,
      salt.toString("base64url"),
      result.toString("base64url"),
    ].join("$");
  }

  async verify(password: string, encodedHash: string | null | undefined): Promise<boolean> {
    const selectedHash = encodedHash ?? await (
      this.dummyHash ??= this.hash("an30-invalid-account-password-placeholder")
    );
    const parts = selectedHash.split("$");
    if (
      parts.length !== 6
      || parts[1] !== "argon2id"
      || parts[2] !== `v=${ARGON2_VERSION}`
      || parts[3] !== `m=${ARGON2_MEMORY_KIB},t=${ARGON2_PASSES},p=${ARGON2_PARALLELISM}`
    ) {
      return false;
    }

    try {
      const salt = Buffer.from(parts[4] ?? "", "base64url");
      const expected = Buffer.from(parts[5] ?? "", "base64url");
      if (salt.length !== 16 || expected.length !== ARGON2_TAG_LENGTH) return false;
      const actual = await derive(password, salt);
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
}
