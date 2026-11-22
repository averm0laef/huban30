/**
 * Customer avatars: 15 pictures in one style (car parts and cars on brand
 * circles, generated for АН-30). The key list and the stable hash pick live in
 * `@an30/contracts`, so the API validates exactly the keys the web can show.
 */
import type { CustomerAvatarKey } from "@an30/contracts";

export { CUSTOMER_AVATAR_KEYS, customerAvatarKey, isCustomerAvatarKey, type CustomerAvatarKey } from "@an30/contracts";

export function customerAvatarSrc(key: CustomerAvatarKey): string {
  return `/avatars/${key}.webp`;
}
