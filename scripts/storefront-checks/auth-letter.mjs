// The letter the worker would send for the newest queued auth event of a recipient on the local stand: decrypted
// with the stand's own key and built by the worker's own template, exactly as it goes to the mail server.
// Prints nothing secret: the letter goes to a file, the link to the caller.
import { readFileSync, writeFileSync } from "node:fs";
import pg from "../../apps/worker/node_modules/pg/lib/index.js";
import { buildAuthEmailTemplate } from "../../apps/worker/dist/outbox-dispatcher.js";
import { decryptSecret } from "../../apps/worker/dist/secret-crypto.js";

/** Settings of the local stand (database, the encryption key, the site's origin); the folder secrets/ is not in Git. */
export const stand = Object.fromEntries(readFileSync(new URL("../../secrets/local_stand.env", import.meta.url), "utf8").split("\n")
  .map((line) => line.match(/^([A-Z_]+)=(.*)$/u)).filter(Boolean).map((match) => [match[1], match[2].replace(/^"|"$/gu, "")]));

export async function letterFor(recipient, topic, saveAs) {
  const client = new pg.Client({ connectionString: stand.DATABASE_URL });
  await client.connect();
  try {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const row = (await client.query(
        "SELECT id, topic, aggregate_id, payload FROM app.outbox_events WHERE topic = $1 AND payload->>'recipient' = $2 ORDER BY created_at DESC LIMIT 1", [topic, recipient],
      )).rows[0];
      if (row) {
        const token = decryptSecret(row.payload.encryptedToken, stand.DATA_ENCRYPTION_KEY, `${row.topic}:${row.aggregate_id}`);
        const letter = buildAuthEmailTemplate(row.topic, token, stand.APP_ORIGIN);
        if (saveAs) { writeFileSync(`${saveAs}.html`, letter.html); writeFileSync(`${saveAs}.txt`, `${letter.subject}\n\n${letter.text}`); }
        const link = letter.text.match(/https?:\/\/\S+/u)?.[0] ?? null;
        return { htmlHasLink: link !== null && letter.html.includes(link.replaceAll("&", "&amp;")), link, subject: letter.subject, textLength: letter.text.length };
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return null;
  } finally {
    await client.end();
  }
}
