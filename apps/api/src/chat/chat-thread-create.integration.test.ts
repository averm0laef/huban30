// Real-database check that a repeated "start a chat" request opens one chat.
// Skipped unless CATALOG_SEARCH_DATABASE_URL points at a scratch database --
// see catalog-search-regression.test.ts for how to prepare one.

import { randomUUID } from "node:crypto";

import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DatabaseService } from "../infrastructure/database.service.js";
import { CryptoService } from "../security/crypto.service.js";
import { ChatService } from "./chat.service.js";

const url = process.env.CATALOG_SEARCH_DATABASE_URL;

/** Chats this file creates carry this subject. */
const SUBJECT = "itcreate chat";

describe.skipIf(!url)("starting a guest chat (real PostgreSQL)", () => {
  let database: DatabaseService;
  let chat: ChatService;

  const body = (clientRequestId?: string, comment = "Есть в наличии?") => ({
    ...(clientRequestId ? { clientRequestId } : {}),
    intake: { comment, intent: "other" },
    subject: SUBJECT,
  });
  const created = async () => (await database.query<{ id: string; messages: string }>(
    `SELECT thread.id,(SELECT count(*)::text FROM app.chat_messages WHERE thread_id=thread.id) AS messages
     FROM app.chat_threads AS thread WHERE thread.subject=$1`, [SUBJECT],
  )).rows;
  const removeChats = () => database.query("DELETE FROM app.chat_threads WHERE subject=$1", [SUBJECT]);

  beforeAll(() => {
    const config = {
      get: () => "test",
      getOrThrow: (name: string) => name === "DATABASE_URL" ? url : Buffer.alloc(32, 7).toString("base64"),
    } as unknown as ConfigService;
    database = new DatabaseService(config);
    chat = new ChatService(database, new CryptoService(config), {} as never, {} as never, {} as never, {} as never);
  });

  beforeEach(removeChats);

  afterAll(async () => {
    await removeChats();
    await database?.onModuleDestroy?.();
  });

  it("opens one chat when the same request arrives five times at once", async () => {
    const request = body(randomUUID());

    const answers = await Promise.all(Array.from({ length: 5 }, () => chat.createForGuest(request, undefined)));

    expect(await created()).toEqual([{ id: answers[0]!.id, messages: "1" }]);
    expect(new Set(answers.map((answer) => answer.id)).size).toBe(1);
    // Every copy of the answer opens the same chat with the same key.
    expect(new Set(answers.map((answer) => answer.guestToken)).size).toBe(1);
    await expect(chat.history(answers[0]!.id, undefined, { guestToken: answers[4]!.guestToken, kind: "guest" }))
      .resolves.toMatchObject({ items: [expect.objectContaining({ senderKind: "guest" })] });
  });

  it("returns the same chat to a retry sent after the first answer was lost", async () => {
    const request = body(randomUUID());
    const first = await chat.createForGuest(request, undefined);

    const retry = await chat.createForGuest(request, undefined);

    expect(retry).toMatchObject({ guestToken: first.guestToken, id: first.id });
    expect(await created()).toHaveLength(1);
  });

  it("refuses the same request id with a different question", async () => {
    const id = randomUUID();
    await chat.createForGuest(body(id), undefined);

    await expect(chat.createForGuest(body(id, "Совсем другой вопрос"), undefined)).rejects.toMatchObject({ status: 409 });
    expect(await created()).toHaveLength(1);
  });

  it("opens separate chats for separate requests", async () => {
    const first = await chat.createForGuest(body(randomUUID()), undefined);
    const second = await chat.createForGuest(body(randomUUID()), undefined);
    const unnamed = await chat.createForGuest(body(), undefined);

    expect(new Set([first.id, second.id, unnamed.id]).size).toBe(3);
    expect(new Set([first.guestToken, second.guestToken, unnamed.guestToken]).size).toBe(3);
  });
});
