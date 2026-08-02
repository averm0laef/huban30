import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";

import { Client } from "pg";
import WebSocket from "ws";

import { validateEnvironment } from "../config.js";

const apiBase = process.env.API_BASE_URL ?? "http://127.0.0.1:4000/api/v1";
const origin = process.env.APP_ORIGIN ?? "http://localhost";
const webSocketUrl = `${apiBase.replace(/^http/u, "ws").replace(/\/api\/v1\/?$/u, "")}/ws`;

interface ThreadResult { guestToken: string; id: string }
interface MessageResult { attachments: Array<{ id: string }>; id: string; sequence: string }

let step = 0;
const createdThreadIds: string[] = [];
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
    body: JSON.stringify({ subject: "Проверка автономного чата" }), method: "POST",
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
  if (history.items.length !== 1 || history.items[0]?.sequence !== message.sequence) {
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

  const foreignSocket = new WebSocket(webSocketUrl, { origin: "https://attacker.invalid" });
  const closeCode = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Invalid-origin socket stayed open")), 5_000);
    foreignSocket.once("close", (code) => { clearTimeout(timer); resolve(code); });
    foreignSocket.once("error", () => undefined);
  });
  if (closeCode !== 1008) throw new Error(`Invalid-origin close code was ${closeCode}`);
  passed("cross-origin WebSocket handshake is rejected");

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const form = new FormData();
  form.set("file", new Blob([png], { type: "image/png" }), "pixel.png");
  const attachment = await request<MessageResult>(`/chat/guest/threads/${first.id}/attachments`, {
    body: form,
    headers: { "x-client-message-id": randomUUID(), "x-guest-chat-token": first.guestToken },
    method: "POST",
  }, 201);
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

  const downloaded = await request<ArrayBuffer>(`/chat/guest/attachments/${attachmentId}`, {
    headers: { "x-guest-chat-token": first.guestToken }, method: "GET",
  }, 200);
  if (!Buffer.from(downloaded).equals(png)) throw new Error("Downloaded attachment differs");
  passed("authorized attachment download preserves exact bytes");

  const second = await request<ThreadResult>("/chat/guest/threads", {
    body: JSON.stringify({ subject: "Другой чат" }), method: "POST",
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
  let keys: string[];
  try {
    await database.query("BEGIN");
    keys = (await database.query<{ storage_key: string }>(
      `SELECT DISTINCT storage.storage_key
       FROM app.chat_messages AS message
       JOIN app.chat_attachments AS attachment ON attachment.message_id=message.id
       JOIN app.storage_objects AS storage ON storage.id=attachment.storage_object_id
       WHERE message.thread_id=ANY($1::uuid[])
         AND NOT EXISTS (
           SELECT 1 FROM app.chat_attachments AS other_attachment
           JOIN app.chat_messages AS other_message ON other_message.id=other_attachment.message_id
           WHERE other_attachment.storage_object_id=storage.id
             AND other_message.thread_id<>ALL($1::uuid[])
             AND other_message.deleted_at IS NULL
         )`,
      [createdThreadIds],
    )).rows.map((row) => row.storage_key);
    await database.query(
      `UPDATE app.storage_objects SET status='deleted',deleted_at=clock_timestamp()
       WHERE id IN (
         SELECT attachment.storage_object_id FROM app.chat_attachments AS attachment
         JOIN app.chat_messages AS message ON message.id=attachment.message_id
         WHERE message.thread_id=ANY($1::uuid[])
       ) AND NOT EXISTS (
         SELECT 1 FROM app.chat_attachments AS other_attachment
         JOIN app.chat_messages AS other_message ON other_message.id=other_attachment.message_id
         WHERE other_attachment.storage_object_id=app.storage_objects.id
           AND other_message.thread_id<>ALL($1::uuid[])
           AND other_message.deleted_at IS NULL
       )`,
      [createdThreadIds],
    );
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
