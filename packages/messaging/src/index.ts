import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { HubPlatform, HubSecrets } from "@an30/contracts";
import { loadPublicImage, type PublicImage } from "./public-image.js";
export { isPublicAddress, loadPublicImage } from "./public-image.js";

export interface Channel {
  platform: HubPlatform; publishTarget: string; inboxTarget: string; secrets: HubSecrets;
}
export interface DiagnosticCheck { name: string; ok: boolean; detail: string; at?: string }
export interface PostContent { title: string; body: string; imageUrl: string | null }
export interface IncomingMessage {
  eventId: string; externalId: string; peerId: string; customerName: string;
  body: string; media: Array<{ type: string; name?: string }>; timestamp: Date;
  edited: boolean;
}
type Json = Record<string, unknown>;
export function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}
export function identifier(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : "";
}
export function parseWebhookJson(raw: Buffer): Json {
  if (raw.byteLength > 512 * 1024) throw new Error("webhook_too_large");
  // Node 24 supplies the original numeric lexeme: do not round int64 chat IDs.
  return object(JSON.parse(raw.toString("utf8"), (_key: string, value: unknown, context?: { source?: string }) =>
    typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value) && context?.source ? context.source : value));
}
export function secretEqual(value: string | undefined, expected: string | undefined): boolean {
  if (!value || !expected || value.length > 1_024) return false;
  const a = createHash("sha256").update(value).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
export function verifyWebhook(channel: Channel, raw: Buffer, headers: Record<string, string | string[] | undefined>): boolean {
  const header = (key: string) => typeof headers[key] === "string" ? headers[key] as string : undefined;
  if (channel.platform === "telegram") return secretEqual(header("x-telegram-bot-api-secret-token"), channel.secrets.webhookSecret);
  if (channel.platform === "max") return secretEqual(header("x-max-bot-api-secret"), channel.secrets.webhookSecret);
  if (channel.platform === "vk") {
    const event = parseWebhookJson(raw);
    if (identifier(event.group_id) !== channel.inboxTarget) return false;
    // VK does not promise the secret on the address confirmation request. The
    // reply to it is only the confirmation string, never customer data, so
    // an absent secret is accepted there; a present but wrong one is not.
    if (event.type === "confirmation" && event.secret === undefined) return true;
    return secretEqual(identifier(event.secret), channel.secrets.webhookSecret);
  }
  if (!channel.secrets.appSecret) return false;
  return secretEqual(header("x-hub-signature-256"), `sha256=${createHmac("sha256", channel.secrets.appSecret).update(raw).digest("hex")}`);
}

/** MAX users: first_name + optional last_name; `name` is deprecated. */
function maxName(user: Json): string {
  return [user.first_name, user.last_name].filter((x): x is string => typeof x === "string" && !!x).join(" ") || identifier(user.name);
}
export function normalizeIncoming(channel: Channel, event: Json, now = new Date()): IncomingMessage[] {
  const boundedTime = (value: unknown, milliseconds = false) => {
    const time = Number(value) * (milliseconds ? 1 : 1_000);
    return Number.isFinite(time) && time > 0 ? new Date(Math.min(now.getTime(), time)) : now;
  };
  const make = (value: Partial<IncomingMessage> & Pick<IncomingMessage, "externalId" | "peerId">): IncomingMessage[] => {
    if (!value.peerId || !value.externalId) return [];
    return [{ eventId: value.externalId, media: [], timestamp: now,
      edited: false, ...value, body: (value.body || "[Вложение]").slice(0, 8_000), customerName: (value.customerName || "Клиент").slice(0, 200) }];
  };
  if (channel.platform === "telegram") {
    const edited = !!event.edited_message;
    const message = object(event.message ?? event.edited_message);
    const chat = object(message.chat), sender = object(message.from);
    if (chat.type !== "private" || sender.is_bot === true) return [];
    const peer = identifier(chat.id), mid = identifier(message.message_id);
    if (!peer || !mid) return [];
    const media = ["photo", "video", "document", "voice", "audio", "sticker"].filter((key) => message[key]).map((type) => ({ type }));
    return make({ externalId: `${peer}:${mid}`, eventId: identifier(event.update_id), peerId: peer,
      customerName: [sender.first_name, sender.last_name].filter((x) => typeof x === "string").join(" "),
      body: identifier(message.text ?? message.caption), media, timestamp: boundedTime(message.date), edited });
  }
  if (channel.platform === "vk") {
    if (event.type !== "message_new" && event.type !== "message_edit") return [];
    const message = object(object(event.object).message ?? event.object);
    const peer = identifier(message.peer_id), sender = identifier(message.from_id);
    // Group chats/echoes must not be turned into private customer conversations.
    if (!/^\d+$/u.test(peer) || peer !== sender || message.out === 1) return [];
    const mid = identifier(message.conversation_message_id ?? message.id);
    if (!mid) return [];
    return make({ externalId: `${peer}:${mid}`, eventId: identifier(event.event_id) || `${event.type}:${peer}:${mid}`,
      peerId: peer, customerName: `Клиент ВКонтакте ${peer}`, body: identifier(message.text),
      media: Array.isArray(message.attachments) ? message.attachments.slice(0, 10).map((a) => ({ type: identifier(object(a).type) || "file" })) : [],
      timestamp: boundedTime(message.date), edited: event.type === "message_edit" });
  }
  if (channel.platform === "max") {
    if (event.update_type !== "message_created" && event.update_type !== "message_edited" && event.update_type !== "bot_started") return [];
    if (event.update_type === "bot_started") {
      const peer = identifier(object(event.user).user_id);
      if (!peer) return [];
      return make({ externalId: `start:${peer}:${identifier(event.timestamp)}`, peerId: `user:${peer}`,
        customerName: maxName(object(event.user)), body: "/start", timestamp: boundedTime(event.timestamp, true) });
    }
    const message = object(event.message), recipient = object(message.recipient), sender = object(message.sender), body = object(message.body);
    if (recipient.chat_type !== "dialog" || sender.is_bot === true) return [];
    const peer = identifier(recipient.chat_id), user = identifier(sender.user_id);
    if (!peer && !user) return [];
    return make({ externalId: identifier(body.mid), eventId: `${identifier(event.update_type)}:${identifier(body.mid)}:${identifier(event.timestamp)}`,
      peerId: user ? `user:${user}` : `chat:${peer}`, customerName: maxName(sender), body: identifier(body.text),
      media: Array.isArray(body.attachments) ? body.attachments.slice(0, 10).map((a) => ({ type: identifier(object(a).type) || "file" })) : [],
      timestamp: boundedTime(message.timestamp ?? event.timestamp, true), edited: event.update_type === "message_edited" });
  }
  const result: IncomingMessage[] = [];
  for (const entry of Array.isArray(event.entry) ? event.entry : []) {
    for (const change of Array.isArray(object(entry).changes) ? object(entry).changes as unknown[] : []) {
      const value = object(object(change).value);
      if (identifier(object(value.metadata).phone_number_id) !== channel.inboxTarget) continue;
      for (const item of Array.isArray(value.messages) ? value.messages : []) {
        const message = object(item);
        const peer = identifier(message.from_user_id) || identifier(message.from);
        const contacts = Array.isArray(value.contacts) ? value.contacts : [];
        const contact = object(contacts.find((c) => identifier(object(c).user_id) === peer || identifier(object(c).wa_id) === peer));
        result.push(...make({ externalId: identifier(message.id), peerId: peer,
          customerName: identifier(object(contact.profile).name), body: identifier(object(message.text).body),
          media: message.type === "text" ? [] : [{ type: identifier(message.type) || "file" }], timestamp: boundedTime(message.timestamp) }));
      }
    }
  }
  return result;
}

export class DeliveryError extends Error {
  /** `repeatable`: an uncertain result may be retried automatically because
   * the operation is idempotent (an edit, VK guid/random_id). */
  constructor(readonly code: string, readonly uncertain = false, readonly retryAfter = 0, readonly repeatable = false) { super(code); }
}
function repeatable<T>(work: Promise<T>): Promise<T> {
  return work.catch((error: unknown) => {
    if (error instanceof DeliveryError && error.uncertain) throw new DeliveryError(error.code, true, error.retryAfter, true);
    throw error;
  });
}
export interface ProviderEndpoints {
  telegram: string; max: string; vk: string; whatsapp: string;
  /** Upload hosts returned by photos.getWallUploadServer that may receive the image. */
  vkUpload: (url: URL) => boolean;
}
export const PROVIDER_ENDPOINTS: ProviderEndpoints = {
  telegram: "https://api.telegram.org",
  max: "https://platform-api2.max.ru",
  vk: "https://api.vk.com",
  whatsapp: "https://graph.facebook.com",
  vkUpload: (url) => url.protocol === "https:" && !url.username && !url.password && !url.port
    && /(^|\.)(vk\.com|vk\.ru|userapi\.com)$/iu.test(url.hostname),
};
/** Local emulator of the provider APIs for end-to-end checks without the
 * real platforms. Only loopback HTTP is accepted and never in production. */
export function emulatorEndpoints(base: string): ProviderEndpoints {
  const url = new URL(base);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.pathname !== "/") throw new Error("emulator_must_be_loopback_http");
  const origin = url.origin;
  return { telegram: `${origin}/telegram`, max: `${origin}/max`, vk: `${origin}/vk`, whatsapp: `${origin}/whatsapp`,
    vkUpload: (upload) => upload.origin === origin && upload.pathname.startsWith("/vk-upload/") };
}
export function emulatorImageLoader(base: string, fetcher: typeof fetch = fetch): (url: string) => Promise<PublicImage> {
  const origin = new URL(base).origin;
  return async (value) => {
    const source = new URL(value);
    const response = await fetcher(`${origin}/images/${source.hostname}${source.pathname}`, { redirect: "error", signal: AbortSignal.timeout(10_000) });
    const bytes = Buffer.from(await response.arrayBuffer());
    const mime = response.headers.get("content-type")?.split(";", 1)[0];
    if (!response.ok || bytes.length > 8 * 1024 * 1024 || !(mime === "image/png" || mime === "image/jpeg" || mime === "image/gif")) throw new Error("image_download_rejected");
    return { bytes: new Uint8Array(bytes), mime, filename: `post.${mime === "image/jpeg" ? "jpg" : mime.slice(6)}` };
  };
}
/** Reads HUB_PROVIDER_EMULATOR_URL. It is refused in production so that a
 * misconfiguration can never divert real customer traffic. */
export function messengerFromEnvironment(env: Record<string, string | undefined>, deploymentEnvironment: string): { client: MessengerClient; emulated: boolean } {
  const base = env.HUB_PROVIDER_EMULATOR_URL?.trim();
  if (!base) return { client: new MessengerClient(), emulated: false };
  if (deploymentEnvironment === "production") throw new Error("HUB_PROVIDER_EMULATOR_URL is forbidden in production");
  return { client: new MessengerClient(fetch, "v26.0", emulatorImageLoader(base), emulatorEndpoints(base)), emulated: true };
}
export function safeImageUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.port && !isIP(u.hostname)
      && u.hostname.includes(".") && !/(^|\.)(localhost|local|internal|test|invalid)$/iu.test(u.hostname);
  } catch { return false; }
}
export class MessengerClient {
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly whatsappVersion = "v26.0",
    private readonly imageLoader: (url: string) => Promise<PublicImage> = loadPublicImage,
    private readonly endpoints: ProviderEndpoints = PROVIDER_ENDPOINTS) {}
  get emulated() { return this.endpoints !== PROVIDER_ENDPOINTS; }

  private async json(url: string, init: RequestInit): Promise<Json> {
    let response: Response;
    try { response = await this.fetcher(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000) }); }
    catch { throw new DeliveryError("provider_result_unknown", true); }
    let bytes = 0; const chunks: Uint8Array[] = [];
    try {
      if (!response.body) throw new Error("No response body");
      for await (const chunk of response.body) {
        bytes += chunk.length; if (bytes > 1024 * 1024) throw new Error("Response too large"); chunks.push(chunk);
      }
      const data = object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (!response.ok && response.status >= 500) throw new DeliveryError("provider_result_unknown", true);
      if (!response.ok || data.ok === false || data.success === false || data.error || typeof data.code === "string") {
        const error = object(data.error);
        const code = Number(data.error_code ?? error.error_code ?? response.status);
        if (identifier(data.description).includes("message is not modified")) return { unchanged: true };
        // MAX answers HTTP 200 with a string `code`; an image fetched by URL
        // may still be processing, which is a documented transient state.
        if (data.code === "attachment.not.ready") throw new DeliveryError("provider_rejected_attachment_not_ready", false, 10);
        const retry = code === 429 || code === 6 ? Math.min(3_600, Math.max(5, Number(object(data.parameters).retry_after) || 30)) : 0;
        throw new DeliveryError(`provider_rejected_${Number.isFinite(code) ? code : typeof data.code === "string" ? data.code.replace(/[^a-z0-9_.-]/giu, "").slice(0, 60) : response.status}`, false, retry);
      }
      return data;
    } catch (error) { if (error instanceof DeliveryError) throw error; throw new DeliveryError("provider_result_unknown", true); }
  }
  private tg(channel: Channel, method: string, data?: Json): Promise<Json> {
    if (!channel.secrets.token) throw new DeliveryError("credentials_missing");
    const token = encodeURIComponent(channel.secrets.token).replace(/%3A/gu, ":");
    return this.json(`${this.endpoints.telegram}/bot${token}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data ?? {}),
    });
  }
  private max(channel: Channel, method: string, path: string, params: Record<string, string> = {}, body?: Json): Promise<Json> {
    if (!channel.secrets.token) throw new DeliveryError("credentials_missing");
    return this.json(`${this.endpoints.max}/${path}?${new URLSearchParams(params)}`, {
      method, headers: { Authorization: channel.secrets.token, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  private vk(channel: Channel, method: string, data: Record<string, string>, wall = false): Promise<Json> {
    const token = wall ? channel.secrets.publishingToken : channel.secrets.token;
    if (!token) throw new DeliveryError("credentials_missing");
    return this.json(`${this.endpoints.vk}/method/${method}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...data, v: "5.199", access_token: token }) });
  }
  private async vkPhoto(channel: Channel, imageUrl: string): Promise<string> {
    // A URL passed directly to wall.post is a link attachment, not a photo.
    // All failures here precede wall.post/edit, so a failed upload cannot
    // mean that the post itself was published.
    try {
      if (!/^-\d+$/u.test(channel.publishTarget)) throw new DeliveryError("invalid_vk_community_id");
      const groupId = channel.publishTarget.slice(1);
      const image = await this.imageLoader(imageUrl);
      const server = object((await this.vk(channel,"photos.getWallUploadServer",{ group_id: groupId },true)).response);
      let uploadUrl: URL;
      try { uploadUrl = new URL(identifier(server.upload_url)); } catch { throw new DeliveryError("invalid_vk_upload_server"); }
      if (!this.endpoints.vkUpload(uploadUrl)) throw new DeliveryError("invalid_vk_upload_server");
      const form = new FormData();
      form.append("photo",new Blob([image.bytes],{type:image.mime}),image.filename);
      const uploaded = await this.json(uploadUrl.toString(),{ method:"POST",body:form });
      const photo = identifier(uploaded.photo), hash = identifier(uploaded.hash), uploadServer = identifier(uploaded.server);
      if (!photo || photo === "[]" || !hash || !uploadServer) throw new DeliveryError("vk_photo_upload_rejected");
      const saved = (await this.vk(channel,"photos.saveWallPhoto",{ group_id:groupId,photo,hash,server:uploadServer },true)).response;
      const attachment = object(Array.isArray(saved) ? saved[0] : undefined);
      const ownerId = identifier(attachment.owner_id), photoId = identifier(attachment.id);
      if (!/^-?\d+$/u.test(ownerId) || !/^\d+$/u.test(photoId)) throw new DeliveryError("vk_photo_save_rejected");
      return `photo${ownerId}_${photoId}`;
    } catch(error) {
      if (error instanceof DeliveryError && !error.uncertain) throw error;
      throw new DeliveryError("vk_photo_preparation_failed");
    }
  }
  /** The account behind a token: MAX bot user_id or VK community id. Read-only. */
  async accountId(channel: Channel): Promise<string> {
    if (channel.platform === "max") return identifier((await this.max(channel, "GET", "me")).user_id);
    if (channel.platform === "vk") {
      const data = object((await this.vk(channel, "groups.getById", {})).response);
      return identifier(object(Array.isArray(data.groups) ? data.groups[0] : undefined).id);
    }
    return "";
  }
  async canonicalPublishTarget(channel: Channel): Promise<string> {
    if (channel.platform !== "telegram") return channel.publishTarget;
    // Resolve usernames and numeric aliases using a read-only operation, so
    // one Telegram channel cannot be configured as several destinations.
    const chat = object((await this.tg(channel,"getChat",{chat_id:channel.publishTarget})).result);
    if (chat.type !== "channel" && chat.type !== "supergroup") throw new DeliveryError("telegram_publish_target_not_channel");
    const id = identifier(chat.id);
    if (!/^-\d{1,20}$/u.test(id) || BigInt(id) >= 0n || BigInt(id) < -(2n ** 63n)) throw new DeliveryError("telegram_publish_target_invalid_id");
    return BigInt(id).toString();
  }
  async publish(channel: Channel, post: PostContent, key: string, externalId: string | null): Promise<string> {
    // Edits are idempotent; a new VK wall post carries `guid`, which VK uses
    // to suppress a repeated post. Only those results may be retried blindly.
    const work = this.publishOnce(channel, post, key, externalId);
    return externalId || channel.platform === "vk" ? repeatable(work) : work;
  }
  private async publishOnce(channel: Channel, post: PostContent, key: string, externalId: string | null): Promise<string> {
    const text = `${post.title}\n\n${post.body}`;
    // Telegram entities need no escaping, unlike parse_mode, so customer text
    // can never break the markup. Offsets are UTF-16 units, as in JS strings.
    const entities = [{ type: "bold", offset: 0, length: post.title.length }];
    if (post.imageUrl && !safeImageUrl(post.imageUrl)) throw new DeliveryError("invalid_image_url");
    if (channel.platform === "telegram") {
      const input: Json = { chat_id: channel.publishTarget };
      if (externalId) input.message_id = externalId;
      let method = externalId ? "editMessageText" : "sendMessage";
      if (post.imageUrl) {
        method = externalId ? "editMessageMedia" : "sendPhoto";
        if (externalId) input.media = { type: "photo", media: post.imageUrl, caption: text, caption_entities: entities };
        else Object.assign(input, { photo: post.imageUrl, caption: text, caption_entities: entities });
      } else Object.assign(input, { text, entities });
      const data = await this.tg(channel, method, input);
      if (data.unchanged && externalId) return externalId;
      const id = identifier(object(data.result).message_id);
      if (!id) throw new DeliveryError("provider_result_unknown", true);
      return id;
    }
    if (channel.platform === "max") {
      const body = { text, attachments: post.imageUrl ? [{ type: "image", payload: { url: post.imageUrl } }] : [] };
      const data = await this.max(channel, externalId ? "PUT" : "POST", "messages", externalId ? { message_id: externalId } : { chat_id: channel.publishTarget }, body);
      if (externalId && data.success === true) return externalId;
      const id = identifier(object(object(data.message).body).mid);
      if (!id) throw new DeliveryError("provider_result_unknown", true);
      return id;
    }
    if (channel.platform === "vk") {
      const attachment = post.imageUrl ? await this.vkPhoto(channel,post.imageUrl) : "";
      const data = await this.vk(channel, externalId ? "wall.edit" : "wall.post", {
        owner_id: channel.publishTarget, message: text, attachments: attachment,
        ...(externalId ? { post_id: externalId } : { guid: key, from_group: "1" }),
      }, true);
      // wall.edit returns {response:{post_id}} (vk-api-schema wall_edit_response);
      // very old API versions answered 1.
      if (externalId && data.response !== 1 && identifier(object(data.response).post_id) !== externalId) throw new DeliveryError("provider_result_unknown",true);
      const id = externalId ?? identifier(object(data.response).post_id);
      if (!id) throw new DeliveryError("provider_result_unknown", true);
      return id;
    }
    throw new DeliveryError("manual_channel_publication");
  }
  async reply(channel: Channel, peerId: string, body: string, key: string): Promise<string> {
    // VK suppresses a repeated random_id, so only VK replies are safe to repeat.
    const work = this.replyOnce(channel, peerId, body, key);
    return channel.platform === "vk" ? repeatable(work) : work;
  }
  private async replyOnce(channel: Channel, peerId: string, body: string, key: string): Promise<string> {
    let id: string;
    if (channel.platform === "telegram") id = identifier(object((await this.tg(channel, "sendMessage", { chat_id: peerId, text: body })).result).message_id);
    else if (channel.platform === "vk") {
      const randomId = createHash("sha256").update(key).digest().readUInt32BE(0) & 0x7fff_ffff;
      id = identifier((await this.vk(channel, "messages.send", { peer_id: peerId, message: body, random_id: String(randomId || 1) })).response);
    } else if (channel.platform === "max") {
      const [type, target] = peerId.split(":");
      const data = await this.max(channel, "POST", "messages", type === "user" ? { user_id: target! } : { chat_id: target! }, { text: body });
      id = identifier(object(object(data.message).body).mid);
    } else {
      if (!channel.secrets.token || !/^\d+$/u.test(channel.inboxTarget) || !/^v\d+\.\d+$/u.test(this.whatsappVersion)) throw new DeliveryError("credentials_missing");
      const data = await this.json(`${this.endpoints.whatsapp}/${this.whatsappVersion}/${channel.inboxTarget}/messages`, {
        method: "POST", headers: { Authorization: `Bearer ${channel.secrets.token}`, "content-type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...(peerId.includes(".") ? { recipient: peerId } : { to: peerId }), type: "text", text: { body } }),
      });
      id = identifier(object(Array.isArray(data.messages) ? data.messages[0] : undefined).id);
    }
    if (!id) throw new DeliveryError("provider_result_unknown", true);
    return id;
  }
  /** Read-only checks for the owner. Nothing is published or reconfigured.
   * `webhookUrl` is this site's address for incoming events. */
  async diagnose(channel: Channel, options: { webhookUrl?: string; publish?: boolean; inbox?: boolean } = {}): Promise<{ checks: DiagnosticCheck[] }> {
    const { webhookUrl, publish = !!channel.publishTarget, inbox = true } = options;
    const checks: DiagnosticCheck[] = [];
    const run = async (name: string, operation: () => Promise<string>) => {
      try { checks.push({ name, ok: true, detail: await operation() }); }
      catch (e) { checks.push({ name, ok: false, detail: e instanceof DeliveryError ? e.code : "check_failed" }); }
    };
    const fail = (code: string): never => { throw new DeliveryError(code); };
    if (!channel.secrets.token && channel.platform !== "whatsapp") {
      checks.push({ name: "Токен", ok: false, detail: "credentials_missing" });
      return { checks };
    }
    if (channel.platform === "telegram") {
      let me: Json = {};
      await run("Токен бота", async () => { me = object((await this.tg(channel, "getMe")).result); return `Бот @${identifier(me.username) || identifier(me.id)} найден`; });
      if (!identifier(me.id)) return { checks };
      if (publish && channel.publishTarget) await run("Канал публикаций", async () => {
        const member = object((await this.tg(channel, "getChatMember", { chat_id: channel.publishTarget, user_id: me.id })
          .catch((e: unknown) => { throw e instanceof DeliveryError && e.code === "provider_rejected_400" ? new DeliveryError("telegram_channel_not_found") : e; })).result);
        if (member.status !== "creator" && !(member.status === "administrator" && member.can_post_messages === true)) fail("channel_publish_permission_missing");
        return member.status === "administrator" && member.can_edit_messages !== true
          ? "Бот может публиковать, но не может редактировать посты: включите право «Редактировать сообщения других»"
          : "Бот — администратор канала: может публиковать и редактировать";
      });
      if (inbox) await run("Сообщения клиентов", async () => {
        const info = object((await this.tg(channel, "getWebhookInfo")).result);
        const url = identifier(info.url);
        if (!url) fail("webhook_not_connected");
        if (webhookUrl && url !== webhookUrl) fail("webhook_points_elsewhere");
        const lastError = identifier(info.last_error_message);
        const lastErrorAt = Number(info.last_error_date) * 1_000;
        if (lastError && Date.now() - lastErrorAt < 60 * 60 * 1_000) fail("telegram_webhook_delivery_failing");
        return "Подключены к этому сайту";
      });
    } else if (channel.platform === "max") {
      let ok = false;
      await run("Токен бота", async () => { const me = await this.max(channel, "GET", "me"); ok = true; return `Бот ${identifier(me.first_name) || identifier(me.username) || "найден"}${me.username ? ` (@${identifier(me.username)})` : ""}`; });
      if (!ok) return { checks };
      if (publish && channel.publishTarget) await run("Канал публикаций", async () => {
        const member = await this.max(channel, "GET", `chats/${encodeURIComponent(channel.publishTarget)}/members/me`)
          .catch((e: unknown) => { throw e instanceof DeliveryError && /^provider_rejected_(400|403|404)/u.test(e.code) ? new DeliveryError("max_channel_not_found") : e; });
        const permissions = Array.isArray(member.permissions) ? member.permissions.map(identifier) : [];
        if (member.is_owner !== true && !(member.is_admin === true && permissions.includes("write"))) fail("channel_publish_permission_missing");
        return "Бот — администратор канала: может публиковать";
      });
      if (inbox) await run("Сообщения клиентов", async () => {
        const current = await this.max(channel, "GET", "subscriptions");
        const urls = (Array.isArray(current.subscriptions) ? current.subscriptions : []).map((item) => identifier(object(item).url));
        if (!urls.length) fail("webhook_not_connected");
        if (webhookUrl && !urls.includes(webhookUrl)) fail("webhook_points_elsewhere");
        return "Подключены к этому сайту";
      });
    } else if (channel.platform === "vk") {
      if (inbox || channel.inboxTarget) await run("Ключ сообщества", async () => {
        const data = object((await this.vk(channel, "groups.getById", {})).response);
        const group = object(Array.isArray(data.groups) ? data.groups[0] : undefined);
        if (channel.inboxTarget && identifier(group.id) !== channel.inboxTarget) fail("vk_token_other_community");
        return `Ключ сообщества «${identifier(group.name) || identifier(group.id)}» (ID ${identifier(group.id)}) принят`;
      });
      if (publish) await run("Токен для публикаций", async () => {
        if (!channel.secrets.publishingToken) fail("vk_publishing_token_missing");
        const mask = Number((await this.vk(channel, "account.getAppPermissions", {}, true)).response);
        // VK access rights bit mask: photos = 4, wall = 8192.
        if (!(mask & 8_192)) fail("vk_wall_permission_missing");
        if (!(mask & 4)) fail("vk_photos_permission_missing");
        if (!/^-\d+$/u.test(channel.publishTarget)) fail("invalid_vk_community_id");
        // Read-only: returns an upload address but stores nothing.
        await this.vk(channel, "photos.getWallUploadServer", { group_id: channel.publishTarget.slice(1) }, true)
          .catch((e: unknown) => { throw e instanceof DeliveryError && /^provider_rejected_(15|27|203)$/u.test(e.code) ? new DeliveryError("vk_not_community_admin") : e; });
        return "Есть права wall и photos, доступ к стене сообщества подтверждён";
      });
    } else {
      checks.push({ name: "Канал WhatsApp", ok: true, detail: "Публикация канала — ручная задача с подтверждением версии" });
      if (channel.inboxTarget) await run("WhatsApp Business", async () => {
        if (!channel.secrets.token) throw new DeliveryError("credentials_missing");
        await this.json(`${this.endpoints.whatsapp}/${this.whatsappVersion}/${encodeURIComponent(channel.inboxTarget)}?fields=id,display_phone_number`, { headers: { Authorization: `Bearer ${channel.secrets.token}` } });
        return "Бизнес-номер доступен";
      });
    }
    return { checks };
  }
  async configureWebhook(channel: Channel, url: string, replace: boolean): Promise<void> {
    if (!(url.startsWith("https://") || (this.emulated && url.startsWith("http://"))) || !channel.secrets.webhookSecret) throw new DeliveryError("https_webhook_and_secret_required");
    if (channel.platform === "max" && !this.emulated && new URL(url).port) throw new DeliveryError("max_webhook_port_not_supported");
    if (channel.platform === "telegram") {
      const current = object((await this.tg(channel, "getWebhookInfo")).result);
      if (current.url && current.url !== url && !replace) throw new DeliveryError("existing_webhook_requires_confirmation");
      await this.tg(channel, "setWebhook", { url, secret_token: channel.secrets.webhookSecret, drop_pending_updates: false, allowed_updates: ["message", "edited_message"] });
    } else if (channel.platform === "max") {
      const current = await this.max(channel, "GET", "subscriptions");
      const others = (Array.isArray(current.subscriptions) ? current.subscriptions : []).map((item) => identifier(object(item).url)).filter((other) => other && other !== url);
      if (others.length && !replace) throw new DeliveryError("existing_webhook_requires_confirmation");
      // DELETE /subscriptions?url=… unsubscribes; only after explicit consent.
      for (const other of others) await this.max(channel, "DELETE", "subscriptions", { url: other });
      // bot_added carries the chat_id of a channel the bot was added to: MAX
      // has no method that lists a bot's channels (dev.max.ru getting-chat-id).
      await this.max(channel, "POST", "subscriptions", {}, { url, secret: channel.secrets.webhookSecret, update_types: ["message_created", "message_edited", "bot_started", "bot_added"] });
    } else throw new DeliveryError("configure_callback_in_provider_dashboard");
  }
}
