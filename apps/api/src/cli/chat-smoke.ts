import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";

import { Client } from "pg";
import WebSocket from "ws";

import { validateEnvironment } from "../config.js";
import {
  CHAT_SMOKE_STORAGE_CONSUMER_GUARDS,
  newlyCreatedSmokeStorage,
  sameSmokeStorageSnapshot,
  type SmokeStorageObject,
} from "./chat-smoke-storage.js";

const apiBase = process.env.API_BASE_URL ?? "http://127.0.0.1:4000/api/v1";
const origin = process.env.APP_ORIGIN ?? "http://localhost";
const webSocketUrl = `${apiBase.replace(/^http/u, "ws").replace(/\/api\/v1\/?$/u, "")}/ws`;

interface ThreadResult { guestToken: string; id: string }
interface MessageResult { attachments: Array<{ id: string }>; id: string; sequence: string }

// A chat starts with the questionnaire: the API refuses a thread without it.
const SMOKE_INTAKE = { comment: "Проверка автономного чата", intent: "other" };

let step = 0;
const createdThreadIds: string[] = [];
const createdStorageObjects = new Map<string, SmokeStorageObject>();
function passed(name: string): void {
  step += 1;
  process.stdout.write(`${step}. ${name}\n`);
}

async function request<T>(path: string, init: RequestInit, expectedStatus: number): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.method && init.method !== "GET") headers.set("origin", origin);
  if (init.body && typeof init.body === "string") headers.set("content-type", "application/json");
  const response = await fetch(`${apiBase}${path}`, { ...init, headers });
  const contentType = response.headers.get("content-type") ?? "";
  const value = contentType.includes("application/json") ? await response.json() : await response.arrayBuffer();
  if (response.status !== expectedStatus) {
    throw new Error(`${init.method ?? "GET"} ${path}: expected ${expectedStatus}, got ${response.status} ${JSON.stringify(value)}`);
  }
  return value as T;
}

async function storageObjectFor(content: Buffer): Promise<SmokeStorageObject | null> {
  const environment = validateEnvironment(process.env);
  const database = new Client({ connectionString: environment.DATABASE_URL });
  await database.connect();
  try {
    return (await database.query<SmokeStorageObject>(
      `SELECT id,status::text,storage_key FROM app.storage_objects
       WHERE provider='local' AND sha256=$1 AND byte_size=$2`,
      [createHash("sha256").update(content).digest(), content.length],
    )).rows[0] ?? null;
  } finally {
    await database.end();
  }
}

async function trackSuccessfulStorage<T>(content: Buffer, upload: () => Promise<T>): Promise<T> {
  const before = await storageObjectFor(content);
  const result = await upload();
  const after = await storageObjectFor(content);
  if (!after) throw new Error("Successful attachment upload has no storage object");
  const created = newlyCreatedSmokeStorage(before, after);
  if (created) createdStorageObjects.set(created.id, created);
  return result;
}

function generatePlayableMp4(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-v", "error",
      "-f", "lavfi", "-i", "color=c=0x101820:s=32x32:r=10:d=0.6",
      "-an", "-c:v", "libx264", "-profile:v", "baseline", "-level", "3.0",
      "-pix_fmt", "yuv420p",
      "-movflags", "frag_keyframe+empty_moov+default_base_moof",
      "-f", "mp4", "pipe:1",
    ], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (error?: Error, value?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value ?? Buffer.alloc(0));
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("Timed out generating the MP4 smoke fixture"));
    }, 15_000);
    timer.unref();
    child.once("error", (error) => finish(error));
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) {
        child.kill("SIGKILL");
        finish(new Error("Generated MP4 fixture exceeded 2 MiB"));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (errors.reduce((total, part) => total + part.length, 0) < 16 * 1024) errors.push(chunk);
    });
    child.once("close", (code) => {
      if (code !== 0) {
        finish(new Error(`ffmpeg fixture generation failed (${code}): ${Buffer.concat(errors).toString("utf8")}`));
        return;
      }
      const result = Buffer.concat(chunks);
      if (result.length === 0) finish(new Error("ffmpeg generated an empty MP4 fixture"));
      else finish(undefined, result);
    });
  });
}

function waitFor(socket: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 5_000);
    const listener = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (message.type !== type) return;
      clearTimeout(timer);
      socket.off("message", listener);
      resolve(message);
    };
    socket.on("message", listener);
  });
}

async function closeThread(threadId: string): Promise<void> {
  const environment = validateEnvironment(process.env);
  const database = new Client({ connectionString: environment.DATABASE_URL });
  await database.connect();
  try {
    await database.query(
      "UPDATE app.chat_threads SET status='closed',closed_at=clock_timestamp() WHERE id=$1",
      [threadId],
    );
  } finally {
    await database.end();
  }
}

async function runSmoke(): Promise<void> {
  const first = await request<ThreadResult>("/chat/guest/threads", {
    body: JSON.stringify({ intake: SMOKE_INTAKE, subject: "Проверка автономного чата" }), method: "POST",
  }, 201);
  createdThreadIds.push(first.id);
  if (first.guestToken.length < 32) throw new Error("Guest token is too short");
  passed("guest thread returns a one-time high-entropy access token");

  await request(`/chat/guest/threads/${first.id}/messages`, {
    headers: { "x-guest-chat-token": "wrong-token-that-is-long-enough-to-test" }, method: "GET",
  }, 404);
  passed("wrong guest token cannot read a thread");

  const clientMessageId = randomUUID();
  const message = await request<MessageResult>(`/chat/guest/threads/${first.id}/messages`, {
    body: JSON.stringify({ body: "Первое сообщение", clientMessageId }),
    headers: { "x-guest-chat-token": first.guestToken }, method: "POST",
  }, 201);
  const replay = await request<MessageResult>(`/chat/guest/threads/${first.id}/messages`, {
    body: JSON.stringify({ body: "Первое сообщение", clientMessageId }),
    headers: { "x-guest-chat-token": first.guestToken }, method: "POST",
  }, 201);
  if (message.id !== replay.id) throw new Error("Idempotent message replay created a duplicate");
  passed("repeated clientMessageId is idempotent");

  await request(`/chat/guest/threads/${first.id}/messages`, {
    body: JSON.stringify({ body: "Другой текст", clientMessageId }),
    headers: { "x-guest-chat-token": first.guestToken }, method: "POST",
  }, 409);
  passed("changed payload under the same clientMessageId is rejected");

  const history = await request<{ items: MessageResult[] }>(
    `/chat/guest/threads/${first.id}/messages?after=0`,
    { headers: { "x-guest-chat-token": first.guestToken }, method: "GET" }, 200,
  );
  // The questionnaire answers are the thread's opening message; ours follows it.
  if (history.items.length !== 2 || history.items[1]?.sequence !== message.sequence) {
    throw new Error("Cursor history is inconsistent");
  }
  passed("cursor history returns persisted messages in order");

  const socket = new WebSocket(webSocketUrl, { origin });
  const helloPromise = waitFor(socket, "hello");
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  await helloPromise;
  const subscribedPromise = waitFor(socket, "subscribed");
  socket.send(JSON.stringify({
    afterSequence: message.sequence,
    guestToken: first.guestToken,
    threadId: first.id,
    type: "subscribe",
  }));
  await subscribedPromise;
  passed("WebSocket accepts same-origin guest subscription without URL credentials");

  const realtimeId = randomUUID();
  const ackPromise = waitFor(socket, "message.ack");
  socket.send(JSON.stringify({ body: "Сообщение WebSocket", clientMessageId: realtimeId, type: "message.send" }));
  const ack = await ackPromise;
  if (ack.clientMessageId !== realtimeId) throw new Error("Realtime ack does not match client id");
  passed("WebSocket message is persisted and acknowledged");
  socket.close();

  const resumed = await request<{ items: MessageResult[] }>(
    `/chat/guest/threads/${first.id}/messages?after=${message.sequence}`,
    { headers: { "x-guest-chat-token": first.guestToken }, method: "GET" }, 200,
  );
  if (resumed.items.length !== 1 || resumed.items[0]?.id !== ack.messageId) {
    throw new Error("Reconnect cursor did not recover the WebSocket message");
  }
  passed("reconnect cursor recovers exactly the missed message");

  const latestWindow = await request<{
    items: MessageResult[];
    nextSequence: string;
    olderCursor: string | null;
  }>(
    `/chat/guest/threads/${first.id}/messages?before=latest&limit=1`,
    { headers: { "x-guest-chat-token": first.guestToken }, method: "GET" },
    200,
  );
  if (
    latestWindow.items.length !== 1
    || latestWindow.items[0]?.id !== ack.messageId
    || latestWindow.nextSequence !== latestWindow.items[0]?.sequence
    || latestWindow.olderCursor !== latestWindow.items[0]?.sequence
  ) {
    throw new Error("Latest bounded history window is inconsistent");
  }
  passed("latest history window exposes stable realtime and older-page cursors");

  const foreignSocket = new WebSocket(webSocketUrl, { origin: "https://attacker.invalid" });
  // A foreign origin is refused before the upgrade (HTTP 403, see main.ts);
  // the handler's own 1008 close is the second line of defence.
  const refusal = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Invalid-origin socket stayed open")), 5_000);
    foreignSocket.once("unexpected-response", (_request, response) => {
      clearTimeout(timer);
      response.resume();
      foreignSocket.terminate();
      resolve(`http ${response.statusCode}`);
    });
    foreignSocket.once("close", (code) => { clearTimeout(timer); resolve(`close ${code}`); });
    foreignSocket.once("error", () => undefined);
  });
  if (refusal !== "http 403" && refusal !== "close 1008") throw new Error(`Invalid-origin socket ended with ${refusal}`);
  passed("cross-origin WebSocket handshake is rejected");

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const form = new FormData();
  form.set("file", new Blob([png], { type: "image/png" }), "pixel.png");
  const attachment = await trackSuccessfulStorage(png, () => request<MessageResult>(
    `/chat/guest/threads/${first.id}/attachments`,
    {
      body: form,
      headers: { "x-client-message-id": randomUUID(), "x-guest-chat-token": first.guestToken },
      method: "POST",
    },
    201,
  ));
  const attachmentId = attachment.attachments[0]?.id;
  if (!attachmentId) throw new Error("Attachment record is missing");
  passed("valid image attachment passes byte signature verification");

  const invalidForm = new FormData();
  invalidForm.set("file", new Blob(["not an image"], { type: "image/png" }), "fake.png");
  await request(`/chat/guest/threads/${first.id}/attachments`, {
    body: invalidForm,
    headers: { "x-client-message-id": randomUUID(), "x-guest-chat-token": first.guestToken },
    method: "POST",
  }, 400);
  passed("forged image MIME is rejected");

  // Assemble the standard antivirus test signature only at runtime so local
  // endpoint protection cannot quarantine this source file. The preceding
  // PNG is valid media and passes magic/MIME checks; clamd must reject it
  // before storage or a database object is created.
  const antivirusTestSignature = [
    "X5O!P%@AP[4\\PZX54(P^)7CC)7}$",
    "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!",
    "$H+H*",
  ].join("");
  const infectedPng = Buffer.concat([png, Buffer.from(antivirusTestSignature, "ascii")]);
  const infectedBefore = await storageObjectFor(infectedPng);
  const infectedForm = new FormData();
  infectedForm.set("file", new Blob([infectedPng], { type: "image/png" }), "scanner-check.png");
  await request(`/chat/guest/threads/${first.id}/attachments`, {
    body: infectedForm,
    headers: { "x-client-message-id": randomUUID(), "x-guest-chat-token": first.guestToken },
    method: "POST",
  }, 400);
  const infectedAfter = await storageObjectFor(infectedPng);
  if (!sameSmokeStorageSnapshot(infectedBefore, infectedAfter)) {
    throw new Error("Rejected antivirus fixture created a storage object");
  }
  passed("clamd rejects a valid-signature media upload before storage/DB mutation");

  const downloaded = await request<ArrayBuffer>(`/chat/guest/attachments/${attachmentId}`, {
    headers: { "x-guest-chat-token": first.guestToken }, method: "GET",
  }, 200);
  if (!Buffer.from(downloaded).equals(png)) throw new Error("Downloaded attachment differs");
  passed("authorized attachment download preserves exact bytes");

  const headerOnlyMp4 = Buffer.from([
    0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
    0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31,
  ]);
  const headerOnlyBefore = await storageObjectFor(headerOnlyMp4);
  const headerOnlyForm = new FormData();
  headerOnlyForm.set("file", new Blob([headerOnlyMp4], { type: "video/mp4" }), "header-only.mp4");
  await request(`/chat/guest/threads/${first.id}/attachments`, {
    body: headerOnlyForm,
    headers: { "x-client-message-id": randomUUID(), "x-guest-chat-token": first.guestToken },
    method: "POST",
  }, 400);
  const headerOnlyAfter = await storageObjectFor(headerOnlyMp4);
  if (!sameSmokeStorageSnapshot(headerOnlyBefore, headerOnlyAfter)) {
    throw new Error("Structurally invalid MP4 created a storage object");
  }
  passed("header-only MP4 passes magic bytes but is rejected by structural validation before storage");

  const mp4 = await generatePlayableMp4();
  const videoForm = new FormData();
  videoForm.set("file", new Blob([Uint8Array.from(mp4)], { type: "video/mp4" }), "short-part-video.mp4");
  const videoAttachment = await trackSuccessfulStorage(mp4, () => request<MessageResult>(
    `/chat/guest/threads/${first.id}/attachments`,
    {
      body: videoForm,
      headers: { "x-client-message-id": randomUUID(), "x-guest-chat-token": first.guestToken },
      method: "POST",
    },
    201,
  ));
  const videoAttachmentId = videoAttachment.attachments[0]?.id;
  if (!videoAttachmentId) throw new Error("Video attachment record is missing");
  const downloadedVideo = await request<ArrayBuffer>(`/chat/guest/attachments/${videoAttachmentId}`, {
    headers: { "x-guest-chat-token": first.guestToken }, method: "GET",
  }, 200);
  if (!Buffer.from(downloadedVideo).equals(mp4)) throw new Error("Downloaded video differs");
  passed("real decodable H.264 MP4 uploads and downloads without byte changes");

  const boundaryBytes = 10 * 1024 * 1024 + 512 * 1024;
  const boundaryMp4 = Buffer.concat([mp4, Buffer.alloc(boundaryBytes - mp4.length)]);
  const boundaryForm = new FormData();
  boundaryForm.set(
    "file",
    new Blob([Uint8Array.from(boundaryMp4)], { type: "video/mp4" }),
    "proxy-boundary.mp4",
  );
  const boundaryAttachment = await trackSuccessfulStorage(boundaryMp4, () => request<MessageResult>(
    `/chat/guest/threads/${first.id}/attachments`,
    {
      body: boundaryForm,
      headers: { "x-client-message-id": randomUUID(), "x-guest-chat-token": first.guestToken },
      method: "POST",
    },
    201,
  ));
  const boundaryAttachmentId = boundaryAttachment.attachments[0]?.id;
  if (!boundaryAttachmentId) throw new Error("Boundary attachment record is missing");
  const downloadedBoundary = await request<ArrayBuffer>(
    `/chat/guest/attachments/${boundaryAttachmentId}`,
    { headers: { "x-guest-chat-token": first.guestToken }, method: "GET" },
    200,
  );
  if (!Buffer.from(downloadedBoundary).equals(boundaryMp4)) {
    throw new Error("Proxy-boundary video differs after streaming download");
  }
  passed("multipart upload and streamed download work above the former 10 MiB proxy limit");

  const second = await request<ThreadResult>("/chat/guest/threads", {
    body: JSON.stringify({ intake: SMOKE_INTAKE, subject: "Другой чат" }), method: "POST",
  }, 201);
  createdThreadIds.push(second.id);
  await request(`/chat/guest/attachments/${attachmentId}`, {
    headers: { "x-guest-chat-token": second.guestToken }, method: "GET",
  }, 404);
  passed("guest cannot read another thread attachment");

  await closeThread(first.id);
  await request(`/chat/guest/threads/${first.id}/messages`, {
    body: JSON.stringify({ body: "Сообщение после закрытия", clientMessageId: randomUUID() }),
    headers: { "x-guest-chat-token": first.guestToken }, method: "POST",
  }, 409);
  passed("closed thread rejects new messages");

  const search = await request<{ ai: { enabled: boolean; fallback: string | null } }>(
    "/catalog/search?q=масляный", { method: "GET" }, 200,
  );
  if (search.ai.enabled || !search.ai.fallback) throw new Error("AI fallback is not explicit");
  passed("catalog search remains deterministic and explains disabled AI");
}

async function cleanup(): Promise<void> {
  if (createdThreadIds.length === 0) return;
  const environment = validateEnvironment(process.env);
  const database = new Client({ connectionString: environment.DATABASE_URL });
  await database.connect();
  let keys: string[] = [];
  try {
    await database.query("BEGIN");
    const ownedStorageIds = [...createdStorageObjects.keys()];
    if (ownedStorageIds.length > 0) {
      keys = (await database.query<{ storage_key: string }>(
        `UPDATE app.storage_objects AS storage
         SET status='deleted',deleted_at=clock_timestamp()
         WHERE storage.id=ANY($2::uuid[])
           AND NOT EXISTS (
             SELECT 1 FROM app.chat_attachments AS other_attachment
             JOIN app.chat_messages AS other_message ON other_message.id=other_attachment.message_id
             WHERE other_attachment.storage_object_id=storage.id
               AND other_message.thread_id<>ALL($1::uuid[])
           )
           ${CHAT_SMOKE_STORAGE_CONSUMER_GUARDS}
         RETURNING storage.storage_key`,
        [createdThreadIds, ownedStorageIds],
      )).rows.map((row) => row.storage_key);
    }
    await database.query(
      "UPDATE app.chat_messages SET deleted_at=clock_timestamp() WHERE thread_id=ANY($1::uuid[])",
      [createdThreadIds],
    );
    await database.query(
      "UPDATE app.chat_threads SET deleted_at=clock_timestamp() WHERE id=ANY($1::uuid[])",
      [createdThreadIds],
    );
    await database.query(
      "DELETE FROM app.outbox_events WHERE aggregate_type='chat_thread' AND aggregate_id=ANY($1::uuid[])",
      [createdThreadIds],
    );
    await database.query("COMMIT");
  } catch (error) {
    await database.query("ROLLBACK");
    throw error;
  } finally {
    await database.end();
  }
  const storageRoot = path.resolve(environment.STORAGE_ROOT);
  await Promise.all(keys.map(async (key) => {
    const target = path.resolve(storageRoot, key);
    if (target.startsWith(`${storageRoot}${path.sep}`)) await rm(target, { force: true });
  }));
}

async function main(): Promise<void> {
  let smokeError: unknown;
  try {
    await runSmoke();
  } catch (error) {
    smokeError = error;
  }
  let cleanupError: unknown;
  try {
    await cleanup();
  } catch (error) {
    cleanupError = error;
  }
  if (smokeError) throw smokeError;
  if (cleanupError) throw cleanupError;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
