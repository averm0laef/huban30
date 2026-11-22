#!/usr/bin/env node
// Plays the 1С side of the standard exchange («Обмен с сайтом», CommerceML) against a site: sign in, start,
// send each file in parts, then ask the site to load it until it says «success». It is how the owner's list
// export (rehearsal-import.xml and rehearsal-offers.xml, see build-commerceml.py) is put on a stand before the real
// 1С is connected, and it checks the same road 1С will take: the address, the account, the allowed networks.
//
//   ONE_C_EXCHANGE_URL=http://host/api/v1/integrations/1c/exchange \
//   ONE_C_EXCHANGE_USER=exchange1c ONE_C_EXCHANGE_PASSWORD_FILE=secrets/…txt \
//   node scripts/catalog-placement/exchange-upload.mjs [folder with rehearsal-*.xml]
//
// The password is read from a file and is never printed. The site must have the exchange switched on for this
// account and this computer's address among the allowed networks («Настройки интеграций»); a refusal is explained
// there, in «Отказы на входе». Nothing is deleted on the site by hand: the files are a full export, and the site
// treats them as 1С's own.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = process.env.ONE_C_EXCHANGE_URL;
const user = process.env.ONE_C_EXCHANGE_USER;
const passwordFile = process.env.ONE_C_EXCHANGE_PASSWORD_FILE;
if (!base || !user || !passwordFile) {
  console.error("Set ONE_C_EXCHANGE_URL, ONE_C_EXCHANGE_USER and ONE_C_EXCHANGE_PASSWORD_FILE (see the head of this file).");
  process.exit(2);
}
const password = readFileSync(passwordFile, "utf8").replace(/[\r\n]+$/u, "");
const folder = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "local-data", "1c");
/** Parts of 4 MB: the site takes up to 8 MB in one request. */
const PART_BYTES = 4 * 1024 * 1024;
const MAX_POLLS = 3000;

let cookie = "";
async function call(parameters, body) {
  const url = `${base}?${new URLSearchParams({ type: "catalog", ...parameters }).toString()}`;
  const headers = cookie ? { Cookie: cookie } : { Authorization: `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}` };
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, body ? { body, headers: { ...headers, "Content-Type": "application/octet-stream" }, method: "POST" } : { headers });
    const text = (await response.text()).trim();
    // The site asks a hurried client to wait; 1С would simply repeat the request.
    if (response.status === 429 && attempt <= 5) { await new Promise((resolve) => setTimeout(resolve, 15_000)); continue; }
    return { status: response.status, text };
  }
}
const stop = (step, answer) => { console.error(`${step}: the site answered ${answer.status} «${answer.text.split("\n").join(" / ").slice(0, 200)}»`); process.exit(1); };

const signedIn = await call({ mode: "checkauth" });
const [verdict, cookieName, cookieValue] = signedIn.text.split("\n");
if (signedIn.status !== 200 || verdict !== "success" || !cookieName || !cookieValue) stop("sign-in", signedIn);
cookie = `${cookieName}=${cookieValue}`;
console.log("signed in");

const started = await call({ mode: "init" });
if (!started.text.startsWith("zip=")) stop("start", started);

for (const [source, name] of [["rehearsal-import.xml", "import.xml"], ["rehearsal-offers.xml", "offers.xml"]]) {
  const file = readFileSync(path.join(folder, source));
  for (let offset = 0; offset < file.length; offset += PART_BYTES) {
    const sent = await call({ filename: name, mode: "file" }, file.subarray(offset, offset + PART_BYTES));
    if (sent.text !== "success") stop(`sending ${name}`, sent);
  }
  console.log(`${name}: sent ${file.length} bytes in ${Math.ceil(file.length / PART_BYTES)} parts`);
  const from = Date.now();
  let polls = 0;
  for (;;) {
    polls += 1;
    const answer = await call({ filename: name, mode: "import" });
    if (answer.text === "success") break;
    if (!answer.text.startsWith("progress") || polls >= MAX_POLLS) stop(`loading ${name}`, answer);
    if (polls % 25 === 0) console.log(`${name}: ${answer.text.split("\n")[1] ?? "loading"} (${polls} polls, ${Math.round((Date.now() - from) / 1000)} s)`);
  }
  console.log(`${name}: loaded in ${polls} polls, ${Math.round((Date.now() - from) / 1000)} s`);
}
console.log("done: the result is in the site's «Импорт из 1С» → «Журнал обменов»");
