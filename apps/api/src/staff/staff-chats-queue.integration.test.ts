// Real-database check of the order of the staff chat queue. Skipped unless
// CATALOG_SEARCH_DATABASE_URL points at a scratch database -- see
// catalog-search-regression.test.ts for how to prepare one.

import { randomBytes } from "node:crypto";

import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/auth-context.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { StaffService } from "./staff.service.js";

const url = process.env.CATALOG_SEARCH_DATABASE_URL;

/** Chats this file creates carry this prefix. */
const PREFIX = "itqueue-";

describe.skipIf(!url)("staff chat queue (real PostgreSQL)", () => {
  let database: DatabaseService;
  let staff: StaffService;
  let auth: AuthContext;

  const removeChats = () => database.query("DELETE FROM app.chat_threads WHERE subject LIKE $1", [`${PREFIX}%`]);

  /** A guest's chat; each message is `[who, minutes ago]`, oldest first. */
  async function chat(name: string, status: string, messages: Array<["guest" | "staff", number]>): Promise<string> {
    const last = messages.at(-1)?.[1] ?? 0;
    const id = (await database.query<{ id: string }>(
      `INSERT INTO app.chat_threads (guest_token_hash,subject,status,last_message_at)
       VALUES ($1,$2,$3::app.chat_thread_status,clock_timestamp()-make_interval(mins => $4)) RETURNING id`,
      [randomBytes(32), `${PREFIX}${name}`, status, last],
    )).rows[0]!.id;
    for (const [who, minutesAgo] of messages) {
      await database.query(
        `INSERT INTO app.chat_messages (thread_id,sender_user_id,sender_kind,body,created_at)
         VALUES ($1,$2,$3,'text',clock_timestamp()-make_interval(mins => $4))`,
        [id, who === "staff" ? auth.userId : null, who, minutesAgo],
      );
    }
    return id;
  }

  const queue = async () => (await staff.chats({ q: PREFIX }, auth)).items as Array<{ subject: string; waitingSince: string | null }>;

  beforeAll(async () => {
    database = new DatabaseService({ get: () => "test", getOrThrow: () => url } as unknown as ConfigService);
    staff = new StaffService({} as never, {} as never, database);
    const email = `${PREFIX}manager@an30.local`;
    const userId = (await database.query<{ id: string }>("SELECT id FROM app.users WHERE email=$1", [email])).rows[0]?.id
      ?? (await database.query<{ id: string }>(
        "INSERT INTO app.users (email,display_name,status) VALUES ($1,'Queue test','active') RETURNING id", [email],
      )).rows[0]!.id;
    auth = {
      csrfTokenHash: Buffer.alloc(32), email, mfaSetupRequired: false, mfaVerified: true,
      role: "manager", sessionId: "44444444-4444-4444-8444-444444444444", userId,
    };
  });

  beforeEach(removeChats);

  afterAll(async () => {
    await removeChats();
    await database?.onModuleDestroy?.();
  });

  it("keeps the customer who has waited longest on top after they write again", async () => {
    // Waiting 50 minutes, asked again a minute ago; the other wrote once 20 minutes ago.
    await chat("long", "waiting_staff", [["guest", 50], ["guest", 1]]);
    await chat("short", "waiting_staff", [["guest", 20]]);

    const items = await queue();

    expect(items.map((item) => item.subject)).toEqual([`${PREFIX}long`, `${PREFIX}short`]);
    const waitedMinutes = Math.round((Date.now() - Date.parse(items[0]!.waitingSince!)) / 60_000);
    expect(waitedMinutes).toBe(50);
  });

  it("counts the wait from the first message after the last staff reply", async () => {
    await chat("answered-then-asked", "waiting_staff", [["guest", 90], ["staff", 80], ["guest", 5]]);
    await chat("never-answered", "waiting_staff", [["guest", 30]]);

    expect((await queue()).map((item) => item.subject)).toEqual([`${PREFIX}never-answered`, `${PREFIX}answered-then-asked`]);
  });

  it("puts waiting customers above open, answered and closed chats", async () => {
    await chat("closed", "closed", [["guest", 3], ["staff", 2]]);
    await chat("answered", "waiting_customer", [["guest", 5], ["staff", 4]]);
    await chat("waiting", "waiting_staff", [["guest", 40]]);

    const items = await queue();

    expect(items.map((item) => item.subject)).toEqual([`${PREFIX}waiting`, `${PREFIX}answered`, `${PREFIX}closed`]);
    expect(items.slice(1).map((item) => item.waitingSince)).toEqual([null, null]);
  });
});
