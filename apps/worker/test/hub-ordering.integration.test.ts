import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { HUB_JOB_PRIORITY_SQL } from "../src/hub-dispatcher.js";

// This suite executes SELECT-only fixtures. An explicit opt-in keeps normal
// unit runs independent of PostgreSQL and never borrows a production URL.
const connectionString=process.env.HUB_ORDERING_DATABASE_URL;
const database=connectionString ? new Pool({connectionString,max:1,statement_timeout:3_000,connectionTimeoutMillis:3_000}) : null;
afterAll(async()=>{await database?.end();});

describe.skipIf(!database)("PostgreSQL messenger queue priority",()=>{
  it("puts a recent operator reply before an old bot reply and an older post",async()=>{
    const result=await database!.query<{id:string}>(`WITH
      j(id,message_id,created_at) AS (VALUES ('post',NULL,1),('bot','message-bot',2),('operator','message-operator',3)),
      m(id,sender_kind) AS (VALUES ('message-bot','bot'),('message-operator','operator'))
      SELECT j.id FROM j LEFT JOIN m ON m.id=j.message_id ORDER BY ${HUB_JOB_PRIORITY_SQL},j.created_at,j.id`);
    expect(result.rows.map(row=>row.id)).toEqual(["operator","bot","post"]);
  });
  it("preserves chronological order and a deterministic tie break within one priority",async()=>{
    const result=await database!.query<{id:string}>(`WITH
      j(id,message_id,created_at) AS (VALUES ('operator-z','message-z',2),('operator-b','message-b',1),('operator-a','message-a',1)),
      m(id,sender_kind) AS (VALUES ('message-z','operator'),('message-b','operator'),('message-a','operator'))
      SELECT j.id FROM j LEFT JOIN m ON m.id=j.message_id ORDER BY ${HUB_JOB_PRIORITY_SQL},j.created_at,j.id`);
    expect(result.rows.map(row=>row.id)).toEqual(["operator-a","operator-b","operator-z"]);
  });
});
