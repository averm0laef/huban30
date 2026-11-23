// Real-database check of what happens to a customer's chat when the manager
// it was assigned to is no longer at work. Skipped unless
// CATALOG_SEARCH_DATABASE_URL points at a scratch database -- see
// catalog-search-regression.test.ts for how to prepare one.

import { randomBytes } from "node:crypto";

import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DatabaseService } from "../infrastructure/database.service.js";
import { AuditService } from "../security/audit.service.js";
import { ManagerDispatchService, UNATTENDED_CHAT_RELEASE_SECONDS } from "./manager-dispatch.module.js";

const url = process.env.CATALOG_SEARCH_DATABASE_URL;

/** Managers and chats this file creates carry this prefix. */
const PREFIX = "itdispatch-";

describe.skipIf(!url)("chats of a manager who left (real PostgreSQL)", () => {
  let database: DatabaseService;
  let dispatch: ManagerDispatchService;
  const publish = vi.fn(async (_event: unknown) => undefined);

  // The audit log is append-only and remembers who connected to a chat, so
  // the managers stay in the scratch database between runs; everything that
  // decides the outcome (chats, sessions, availability) is removed.
  async function removeEverythingThisFileCreated(): Promise<void> {
    const staff = "SELECT id FROM app.users WHERE email LIKE $1";
    await database.query("DELETE FROM app.chat_threads WHERE subject LIKE $1", [`${PREFIX}%`]);
    await database.query(`DELETE FROM app.manager_availability WHERE user_id IN (${staff})`, [`${PREFIX}%`]);
    await database.query(`DELETE FROM app.auth_sessions WHERE user_id IN (${staff})`, [`${PREFIX}%`]);
  }

  async function manager(name: string, atWork: boolean): Promise<string> {
    const email = `${PREFIX}${name}@an30.local`;
    const existing = (await database.query<{ id: string }>("SELECT id FROM app.users WHERE email=$1", [email])).rows[0]?.id;
    const id = existing ?? (await database.query<{ id: string }>(
      "INSERT INTO app.users (email,display_name,status) VALUES ($1,$2,'active') RETURNING id", [email, name],
    )).rows[0]!.id;
    await database.query(
      "INSERT INTO app.staff_members (user_id,role,status) VALUES ($1,'manager','active') ON CONFLICT (user_id) DO NOTHING",
      [id],
    );
    if (atWork) {
      const session = (await database.query<{ id: string }>(
        `INSERT INTO app.auth_sessions (user_id,session_hash,csrf_token_hash,expires_at,idle_expires_at,mfa_verified_at)
         VALUES ($1,$2,$3,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '30 minutes',clock_timestamp())
         RETURNING id`,
        [id, randomBytes(32), randomBytes(32)],
      )).rows[0]!.id;
      await database.query(
        "INSERT INTO app.manager_availability (user_id,session_id,expires_at) VALUES ($1,$2,clock_timestamp()+interval '55 seconds')",
        [id, session],
      );
    }
    return id;
  }

  /** `idleSeconds` is how long ago anything last happened in the chat. */
  async function chat(input: { assignedTo: string; idleSeconds: number; status?: string }): Promise<string> {
    return (await database.query<{ id: string }>(
      `INSERT INTO app.chat_threads (guest_token_hash,subject,status,assigned_staff_id,last_message_at,updated_at)
       VALUES ($1,$2,$3::app.chat_thread_status,$4,clock_timestamp()-make_interval(secs => $5),clock_timestamp()-make_interval(secs => $5))
       RETURNING id`,
      [randomBytes(32), `${PREFIX}chat`, input.status ?? "waiting_staff", input.assignedTo, input.idleSeconds],
    )).rows[0]!.id;
  }

  const stateOf = async (threadId: string) => (await database.query<{
    assigned_staff_id: string | null; manager_wait_since: Date | null; status: string;
  }>("SELECT assigned_staff_id,manager_wait_since,status FROM app.chat_threads WHERE id=$1", [threadId])).rows[0]!;

  beforeAll(() => {
    database = new DatabaseService({ get: () => "test", getOrThrow: () => url } as unknown as ConfigService);
    dispatch = new ManagerDispatchService(
      database,
      { publish } as never,
      new AuditService(database),
      { consume: async () => undefined } as never,
      { getOrThrow: () => "test" } as unknown as ConfigService,
    );
  });

  beforeEach(async () => {
    await removeEverythingThisFileCreated();
    publish.mockClear();
  });

  afterAll(async () => {
    await removeEverythingThisFileCreated();
    await database?.onModuleDestroy?.();
  });

  it("hands an unanswered chat to a manager who is at work", async () => {
    const left = await manager("left", false);
    const atWork = await manager("at-work", true);
    const threadId = await chat({ assignedTo: left, idleSeconds: UNATTENDED_CHAT_RELEASE_SECONDS + 60 });

    await dispatch.dispatch();

    expect((await stateOf(threadId)).assigned_staff_id).toBe(atWork);
    // The customer's page is told about both steps, in order.
    const events = publish.mock.calls.map(([event]) => event as { payload: { assignedStaffId: string | null }; threadId: string })
      .filter((event) => event.threadId === threadId);
    expect(events.map((event) => event.payload.assignedStaffId)).toEqual([null, atWork]);
    const audit = (await database.query<{ action: string; metadata: { previousStaffId?: string } }>(
      "SELECT action,metadata FROM app.audit_log WHERE entity_id=$1 ORDER BY created_at,id", [threadId],
    )).rows;
    expect(audit.map((row) => row.action)).toEqual(["chat.manager_released", "chat.manager_connected"]);
    expect(audit[0]!.metadata.previousStaffId).toBe(left);
  });

  it("puts the chat back in the queue when nobody is at work", async () => {
    const left = await manager("left", false);
    const threadId = await chat({ assignedTo: left, idleSeconds: UNATTENDED_CHAT_RELEASE_SECONDS + 60 });

    await dispatch.dispatch();

    const state = await stateOf(threadId);
    expect(state.assigned_staff_id).toBeNull();
    expect(state.status).toBe("waiting_staff");
    expect(state.manager_wait_since).toBeInstanceOf(Date);
  });

  it("returns the chat to the front of the queue: the customer has already waited", async () => {
    const left = await manager("left", false);
    const idleSeconds = UNATTENDED_CHAT_RELEASE_SECONDS + 600;
    const threadId = await chat({ assignedTo: left, idleSeconds });

    await dispatch.dispatch();

    // The wait is counted from when the chat last changed, not from the release.
    const waitedSeconds = (Date.now() - (await stateOf(threadId)).manager_wait_since!.getTime()) / 1000;
    expect(waitedSeconds).toBeGreaterThan(idleSeconds - 30);
    expect(waitedSeconds).toBeLessThan(idleSeconds + 30);
  });

  it("leaves the chat with a manager who is still at work, however long it waits", async () => {
    const busy = await manager("busy", true);
    const threadId = await chat({ assignedTo: busy, idleSeconds: UNATTENDED_CHAT_RELEASE_SECONDS * 10 });

    await dispatch.dispatch();

    expect((await stateOf(threadId)).assigned_staff_id).toBe(busy);
    expect(publish).not.toHaveBeenCalled();
  });

  it("gives a manager who stepped away the whole release window before taking the chat back", async () => {
    const left = await manager("left", false);
    await manager("at-work", true);
    const threadId = await chat({ assignedTo: left, idleSeconds: UNATTENDED_CHAT_RELEASE_SECONDS - 60 });

    await dispatch.dispatch();

    expect((await stateOf(threadId)).assigned_staff_id).toBe(left);
  });

  it("keeps an answered chat with its manager", async () => {
    const left = await manager("left", false);
    await manager("at-work", true);
    const threadId = await chat({
      assignedTo: left, idleSeconds: UNATTENDED_CHAT_RELEASE_SECONDS * 10, status: "waiting_customer",
    });

    await dispatch.dispatch();

    expect((await stateOf(threadId)).assigned_staff_id).toBe(left);
  });
});
