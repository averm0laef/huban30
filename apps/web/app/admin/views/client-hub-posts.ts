import type { HubConnectionView, HubJobView } from "@an30/contracts";

type Destination = Pick<HubConnectionView, "platform" | "publishTarget" | "publicUrl">;

const TELEGRAM_PUBLIC = /^https:\/\/t\.me\/([A-Za-z0-9_]{4,})\/?$/u;

function telegramChannel(destination: Destination): { name?: string; internal?: string } {
  const name = TELEGRAM_PUBLIC.exec(destination.publicUrl)?.[1] ?? /^@([A-Za-z0-9_]{4,})$/u.exec(destination.publishTarget)?.[1];
  return { name, internal: /^-100(\d+)$/u.exec(destination.publishTarget)?.[1] };
}

/** Address of the post on the platform, when saved IDs are enough to build it. */
export function publishedPostUrl(destination: Destination, externalId: string | null): string | null {
  if (!externalId || !/^\d+$/u.test(externalId)) return null;
  if (destination.platform === "telegram") {
    const { name, internal } = telegramChannel(destination);
    return name ? `https://t.me/${name}/${externalId}` : internal ? `https://t.me/c/${internal}/${externalId}` : null;
  }
  if (destination.platform === "vk") return /^-\d+$/u.test(destination.publishTarget) ? `https://vk.com/wall${destination.publishTarget}_${externalId}` : null;
  return null;
}

/**
 * Reads the ID from what the administrator pasted: the number or a link to the post.
 * `unverified` marks a link whose channel could not be compared with the saved destination.
 */
export function postIdFromInput(destination: Destination, input: string): { id: string; unverified?: true } | { error: "unrecognized" | "other_channel" } {
  const value = input.trim();
  if (destination.platform !== "telegram" && destination.platform !== "vk") return value ? { id: value } : { error: "unrecognized" };
  if (/^\d+$/u.test(value)) return { id: value };
  if (destination.platform === "telegram") {
    const link = /^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:s\/)?(c\/\d+|[A-Za-z0-9_]{4,})\/(\d+)(?:[?#].*)?$/u.exec(value);
    if (!link) return { error: "unrecognized" };
    const { name, internal } = telegramChannel(destination);
    // A link names the channel either by its number or by its name, and only the same form can be compared.
    const [linked, saved] = link[1]!.startsWith("c/") ? [link[1]!.slice(2), internal] : [link[1]!.toLowerCase(), name?.toLowerCase()];
    return saved === undefined ? { id: link[2]!, unverified: true } : linked === saved ? { id: link[2]! } : { error: "other_channel" };
  }
  const wall = /wall(-?\d+)_(\d+)/u.exec(value);
  if (!wall) return { error: "unrecognized" };
  return !destination.publishTarget ? { id: wall[2]!, unverified: true } : wall[1] === destination.publishTarget ? { id: wall[2]! } : { error: "other_channel" };
}

/** Telegram cannot add a photo to a published text post or take it away from a photo post. */
export function telegramPhotoChange(jobs: HubJobView[], imageUrl: string | null): "added" | "removed" | null {
  for (const job of jobs) {
    if (job.platform !== "telegram" || !job.externalId) continue;
    if (job.contentKind === "text" && imageUrl) return "added";
    if (job.contentKind === "image" && !imageUrl) return "removed";
  }
  return null;
}
