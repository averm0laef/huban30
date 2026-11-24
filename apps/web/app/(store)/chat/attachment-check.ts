/**
 * What the chat checks before a file is sent (board «Маски полей и предпросмотр фото»): the kinds the server takes
 * and its limits (apps/api chat.service.ts: photos 5 MB, video 15 MB) — so a customer learns at once, not after a
 * long upload, that a file will not go.
 */
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
export const CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const CHAT_VIDEO_MAX_BYTES = 15 * 1024 * 1024;

export type AttachmentCheck = { kind: "image" | "video"; ok: true } | { message: string; ok: false };

export function checkChatAttachment(file: { size: number; type: string }): AttachmentCheck {
  if (IMAGE_TYPES.has(file.type)) {
    return file.size <= CHAT_IMAGE_MAX_BYTES ? { kind: "image", ok: true } : { message: `Фото больше 5 МБ (${formatSize(file.size)}). Уменьшите его или сделайте снимок заново.`, ok: false };
  }
  if (VIDEO_TYPES.has(file.type)) {
    return file.size <= CHAT_VIDEO_MAX_BYTES ? { kind: "video", ok: true } : { message: `Видео больше 15 МБ (${formatSize(file.size)}). Обрежьте его или пришлите фото.`, ok: false };
  }
  return { message: "Этот файл не отправить: подойдут фото JPG, PNG, WEBP или видео MP4, MOV, WEBM.", ok: false };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  const megabytes = bytes / 1024 / 1024;
  return `${megabytes >= 10 ? Math.round(megabytes) : megabytes.toFixed(1).replace(".", ",")} МБ`;
}
