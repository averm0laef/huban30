#!/usr/bin/env node
// A local stand-in for Telegram, MAX and VK: the API and the worker talk to it instead of the real platforms when
// HUB_PROVIDER_EMULATOR_URL=http://127.0.0.1:<port> is set (see docs/CLIENT_HUB.md). Nothing leaves this computer.
//
//   node scripts/client-hub-checks/provider-emulator.mjs [port]        # 4901 by default
//
// It keeps what was "published" in memory and answers the way the platforms do in the cases the site relies on:
// Telegram refuses to turn a text post into a photo post and the reverse, and reports an unchanged edit; VK returns
// the same post for a repeated `guid` and the same message for a repeated `random_id`.
//
//   GET  /_emulator/state   what was published and every call received (tokens are not kept)
//   POST /_emulator/fault   {"platform":"telegram","method":"sendMessage","mode":"reject"|"error500"|"drop","times":1}
//                           the next `times` calls of that method fail: a refusal, a server error, or a broken
//                           connection after the post was accepted ("drop" - the site cannot know the result)
//   POST /_emulator/reset   forget everything
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const numberFrom = (text, digits = 9) => String(BigInt(`0x${createHash("sha256").update(text).digest("hex").slice(0, 12)}`) % BigInt(10 ** digits) + 1n);

export function createEmulator() {
  let state, faults;
  const reset = () => {
    state = { telegram: { posts: {}, webhooks: {} }, max: { posts: {}, subscriptions: {} }, vk: { posts: {}, messages: {}, photos: 0 }, calls: [] };
    faults = [];
  };
  reset();
  let sequence = 1_000;
  const next = () => String(++sequence);

  // The id a token stands for: `...:group-123` and `...:bot-123` let a check choose it, anything else gets a stable one.
  const accountOf = (token, kind) => new RegExp(`${kind}-(\\d+)`, "u").exec(token)?.[1] ?? numberFrom(token);
  const telegramChat = (value) => /^-\d+$/u.test(String(value)) ? String(value) : `-100${numberFrom(String(value), 10)}`;

  function telegram(method, token, input) {
    const fail = (description, code = 400) => ({ status: code, body: { ok: false, error_code: code, description } });
    const ok = (result) => ({ status: 200, body: { ok: true, result } });
    const bot = accountOf(token, "bot");
    if (method === "getMe") return ok({ id: Number(bot), is_bot: true, first_name: "АН-30 (имитация)", username: `an30_emulator_${bot}_bot` });
    if (method === "getChat") return /^\d+$/u.test(String(input.chat_id))
      ? ok({ id: Number(input.chat_id), type: "private" })
      : ok({ id: Number(telegramChat(input.chat_id)), type: "channel", title: "Канал (имитация)" });
    if (method === "getChatMember") return ok({ status: "administrator", can_post_messages: true, can_edit_messages: true, user: { id: Number(bot) } });
    if (method === "getWebhookInfo") return ok({ url: state.telegram.webhooks[bot]?.url ?? "", pending_update_count: 0 });
    if (method === "setWebhook") { state.telegram.webhooks[bot] = { url: input.url, allowedUpdates: input.allowed_updates ?? [] }; return ok(true); }
    if (method === "sendMessage" || method === "sendPhoto") {
      const text = method === "sendPhoto" ? input.caption : input.text;
      if (!text) return fail("Bad Request: message text is empty");
      if (method === "sendPhoto" && String(text).length > 1_024) return fail("Bad Request: message caption is too long");
      if (String(text).length > 4_096) return fail("Bad Request: message is too long");
      const id = next(), chat = /^\d+$/u.test(String(input.chat_id)) ? String(input.chat_id) : telegramChat(input.chat_id);
      state.telegram.posts[`${chat}:${id}`] = { chat, id, kind: method === "sendPhoto" ? "photo" : "text", text, photo: input.photo ?? null, edits: 0 };
      return ok({ message_id: Number(id), chat: { id: Number(chat) } });
    }
    if (method === "editMessageText" || method === "editMessageMedia") {
      const chat = telegramChat(input.chat_id), post = state.telegram.posts[`${chat}:${input.message_id}`];
      if (!post) return fail("Bad Request: message to edit not found");
      const media = method === "editMessageMedia";
      if (media && post.kind === "text") return fail("Bad Request: message can't be edited");
      if (!media && post.kind === "photo") return fail("Bad Request: there is no text in the message to edit");
      const text = media ? input.media?.caption : input.text, photo = media ? input.media?.media : null;
      if (post.text === text && post.photo === photo) return fail("Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message");
      Object.assign(post, { text, photo, edits: post.edits + 1 });
      return ok({ message_id: Number(post.id), chat: { id: Number(chat) } });
    }
    return fail("Not Found: method not found", 404);
  }

  function max(method, path, query, token, input) {
    const bot = accountOf(token, "bot"), ok = (body) => ({ status: 200, body });
    if (path === "me") return ok({ user_id: Number(bot), first_name: "АН-30 (имитация)", username: `an30_emulator_${bot}_bot`, is_bot: true });
    if (path === "subscriptions") {
      const list = state.max.subscriptions[bot] ??= [];
      if (method === "GET") return ok({ subscriptions: list });
      if (method === "DELETE") { state.max.subscriptions[bot] = list.filter((item) => item.url !== query.get("url")); return ok({ success: true }); }
      list.push({ url: input.url, update_types: input.update_types ?? [], time: Date.now() });
      return ok({ success: true });
    }
    if (/^chats\/[^/]+\/members\/me$/u.test(path)) return ok({ user_id: Number(bot), is_admin: true, is_owner: false, permissions: ["read_all_messages", "write"] });
    if (path === "messages" && method === "POST") {
      if (!input.text) return { status: 400, body: { code: "proto.payload", message: "text is empty" } };
      const mid = `mid.${next()}`, target = query.get("chat_id") ? `chat:${query.get("chat_id")}` : `user:${query.get("user_id")}`;
      state.max.posts[mid] = { target, id: mid, text: input.text, image: input.attachments?.[0]?.payload?.url ?? null, edits: 0 };
      return ok({ message: { body: { mid, text: input.text }, recipient: { chat_id: Number(query.get("chat_id") ?? 0) } } });
    }
    if (path === "messages" && method === "PUT") {
      const post = state.max.posts[query.get("message_id") ?? ""];
      if (!post) return { status: 404, body: { code: "not.found", message: "message not found" } };
      Object.assign(post, { text: input.text, image: input.attachments?.[0]?.payload?.url ?? null, edits: post.edits + 1 });
      return ok({ success: true });
    }
    return { status: 404, body: { code: "not.found", message: "unknown method" } };
  }

  function vk(method, form, origin) {
    const ok = (response) => ({ status: 200, body: { response } });
    const fail = (code, message) => ({ status: 200, body: { error: { error_code: code, error_msg: message } } });
    const token = form.get("access_token") ?? "", group = accountOf(token, "group");
    if (!token) return fail(5, "User authorization failed: no access_token passed.");
    if (method === "groups.getById") return ok({ groups: [{ id: Number(group), name: "Сообщество (имитация)", screen_name: `club${group}` }] });
    if (method === "account.getAppPermissions") return ok(4 + 8_192 + 65_536);
    if (method === "photos.getWallUploadServer") return ok({ upload_url: `${origin}/vk-upload/${form.get("group_id")}`, album_id: -14, user_id: 1 });
    if (method === "photos.saveWallPhoto") {
      if (!form.get("photo") || !form.get("hash") || !form.get("server")) return fail(100, "One of the parameters specified was missing or invalid");
      return ok([{ id: 457_239_000 + ++state.vk.photos, owner_id: -Number(form.get("group_id")), album_id: -14 }]);
    }
    if (method === "wall.post") {
      const owner = form.get("owner_id") ?? "", guid = form.get("guid") ?? "";
      if (!form.get("message") && !form.get("attachments")) return fail(100, "One of the parameters specified was missing or invalid: message is undefined");
      const repeated = guid && Object.values(state.vk.posts).find((post) => post.owner === owner && post.guid === guid);
      if (repeated) return ok({ post_id: Number(repeated.id) });
      const id = next();
      state.vk.posts[`${owner}_${id}`] = { owner, id, guid, text: form.get("message") ?? "", attachments: form.get("attachments") ?? "", fromGroup: form.get("from_group") === "1", edits: 0 };
      return ok({ post_id: Number(id) });
    }
    if (method === "wall.edit") {
      const post = state.vk.posts[`${form.get("owner_id")}_${form.get("post_id")}`];
      if (!post) return fail(100, "One of the parameters specified was missing or invalid: post_id is invalid");
      Object.assign(post, { text: form.get("message") ?? "", attachments: form.get("attachments") ?? "", edits: post.edits + 1 });
      return ok({ post_id: Number(post.id) });
    }
    if (method === "messages.send") {
      const key = `${form.get("peer_id")}:${form.get("random_id")}`;
      state.vk.messages[key] ??= { id: next(), peer: form.get("peer_id"), text: form.get("message") ?? "" };
      return ok(Number(state.vk.messages[key].id));
    }
    return fail(3, "Unknown method passed");
  }

  async function handle(request, response) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks), url = new URL(request.url ?? "/", `http://${request.headers.host}`), origin = url.origin;
    const send = (status, body, type = "application/json") => {
      response.writeHead(status, { "content-type": type });
      response.end(Buffer.isBuffer(body) ? body : typeof body === "string" ? body : JSON.stringify(body));
    };
    const json = () => { try { return JSON.parse(raw.toString("utf8") || "{}"); } catch { return {}; } };
    if (url.pathname === "/_emulator/state") return send(200, state);
    if (url.pathname === "/_emulator/reset") { reset(); return send(200, { ok: true }); }
    if (url.pathname === "/_emulator/fault") {
      const fault = json();
      if (!["reject", "error500", "drop"].includes(fault.mode) || !fault.platform || !fault.method) return send(400, { error: "platform, method and mode (reject|error500|drop) are required" });
      faults.push({ platform: fault.platform, method: fault.method, mode: fault.mode, times: Math.max(1, Number(fault.times) || 1) });
      return send(200, { ok: true });
    }
    if (url.pathname.startsWith("/images/")) { state.calls.push({ platform: "images", method: url.pathname.slice(8) }); return send(200, PNG, "image/png"); }
    if (url.pathname.startsWith("/vk-upload/")) {
      state.calls.push({ platform: "vk", method: "upload" });
      return send(200, { server: 1, photo: JSON.stringify([{ photo: "emulated", sizes: [] }]), hash: createHash("sha256").update(raw).digest("hex").slice(0, 32) });
    }
    let platform, method, work;
    const telegramCall = /^\/telegram\/bot([^/]+)\/([A-Za-z]+)$/u.exec(url.pathname);
    if (telegramCall) { platform = "telegram"; method = telegramCall[2]; const input = json(); work = () => telegram(method, decodeURIComponent(telegramCall[1]), input); }
    else if (url.pathname.startsWith("/max/")) {
      platform = "max"; const path = url.pathname.slice(5); method = `${request.method} ${path.replace(/^chats\/[^/]+\//u, "chats/{id}/")}`;
      const input = json(); work = () => max(request.method, path, url.searchParams, String(request.headers.authorization ?? ""), input);
    } else if (url.pathname.startsWith("/vk/method/")) {
      platform = "vk"; method = url.pathname.slice(11); const form = new URLSearchParams(raw.toString("utf8")); work = () => vk(method, form, origin);
    } else return send(404, { error: "unknown address" });
    state.calls.push({ platform, method });
    const fault = faults.find((item) => item.platform === platform && item.method === method);
    if (fault && --fault.times <= 0) faults.splice(faults.indexOf(fault), 1);
    if (fault?.mode === "error500") return send(502, { ok: false, description: "Bad Gateway" });
    if (fault?.mode === "reject") return platform === "vk" ? send(200, { error: { error_code: 15, error_msg: "Access denied" } })
      : platform === "max" ? send(403, { code: "access.denied", message: "Access denied" })
      : send(403, { ok: false, error_code: 403, description: "Forbidden: bot is not a member of the channel chat" });
    const result = work();
    // The platform did the work, the answer was lost on the way back.
    if (fault?.mode === "drop") return void request.socket.destroy();
    return send(result.status, result.body);
  }
  const server = createServer((request, response) => {
    handle(request, response).catch(() => { if (!response.headersSent) response.writeHead(500); response.end(); });
  });
  return { server, state: () => state, reset };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.argv[2] ?? process.env.HUB_EMULATOR_PORT ?? 4901);
  // Loopback only: the emulator accepts any token and must not be reachable from the network.
  createEmulator().server.listen(port, "127.0.0.1", () => process.stdout.write(`Provider emulator: http://127.0.0.1:${port}\n`));
}
