import { z } from "zod";

/**
 * Customer avatars: 15 pictures in one style (public/avatars/customer-NN.webp).
 * A customer without a chosen picture gets one picked from a stable hash of
 * their id, so the same person shows the same avatar in the chat, the profile
 * and the staff inbox. Shared by the API (validation) and the web.
 */
export const CUSTOMER_AVATAR_KEYS = [
  "customer-01", "customer-02", "customer-03", "customer-04", "customer-05",
  "customer-06", "customer-07", "customer-08", "customer-09", "customer-10",
  "customer-11", "customer-12", "customer-13", "customer-14", "customer-15",
] as const;

export type CustomerAvatarKey = (typeof CUSTOMER_AVATAR_KEYS)[number];
export const CustomerAvatarKeySchema = z.enum(CUSTOMER_AVATAR_KEYS);
export const AccountAvatarUpdateSchema = z.object({ avatarKey: CustomerAvatarKeySchema.nullable() }).strict();

export function isCustomerAvatarKey(value: unknown): value is CustomerAvatarKey {
  return typeof value === "string" && (CUSTOMER_AVATAR_KEYS as readonly string[]).includes(value);
}

/** FNV-1a: small, stable across runtimes, good enough to spread ids evenly. */
function hash(input: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

export function customerAvatarKey(seed: string, chosen?: string | null): CustomerAvatarKey {
  if (isCustomerAvatarKey(chosen)) return chosen;
  return CUSTOMER_AVATAR_KEYS[hash(seed) % CUSTOMER_AVATAR_KEYS.length]!;
}

/** «Ч-000123»: the number staff and customers use to refer to a chat. */
export function chatNumberLabel(publicNumber: number | string | null | undefined): string | null {
  if (publicNumber === null || publicNumber === undefined || publicNumber === "") return null;
  const digits = String(publicNumber);
  return /^\d{1,15}$/u.test(digits) ? `Ч-${digits.padStart(6, "0")}` : null;
}

/** Accepts «Ч-000123», «ч123», «#123» or «123» and returns 123. */
export function parseChatNumber(value: string): number | null {
  const match = /^\s*(?:[чЧ]\s*-?\s*|#|№\s*)?0*(\d{1,12})\s*$/u.exec(value);
  return match ? Number(match[1]) : null;
}
