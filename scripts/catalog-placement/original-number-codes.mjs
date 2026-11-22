// Finds the part codes of Japanese and Korean original numbers («48815-60111»: the first five digits say what the
// part is) on which the shop's clearly named items agree, and how many queued items each would settle. Honda writes
// its numbers differently («51306-S47-003») and its codes are its own, so they are counted apart. The output is the
// candidate list for the tables in apps/api/src/catalog/catalog-original-numbers.ts; every line is to be read by
// eye before it goes there.
// Usage: node scripts/catalog-placement/original-number-codes.mjs [min placed] [min agreement] [examples per code]
import { decideStorefrontCategory } from "../../apps/api/dist/catalog/catalog-known-categories.js";
import { loadItems, oneLine, QUEUE } from "./lib.mjs";

const minPlaced = Number(process.argv[2] ?? 8);
const minShare = Number(process.argv[3] ?? 0.95);
const examplesPerCode = Number(process.argv[4] ?? 1);
const FORMATS = [
  ["5-5", /(?:^|[^0-9A-Za-z])(?:[A-Z]{1,3}P?-)?(\d{5})-[0-9A-Z]{5}(?![0-9A-Za-z-])/u],
  ["honda", /(?:^|[^0-9A-Za-z])(?:[A-Z]{1,3}P?-)?(\d{5})-[0-9A-Z]{3}-[0-9A-Z]{3}(?![0-9A-Za-z-])/u],
];
const codes = new Map();
for (const item of loadItems()) {
  const text = `${item.sku} ${item.name}`;
  const hit = FORMATS.map(([format, pattern]) => [format, pattern.exec(text)?.[1]]).find(([, code]) => code);
  if (!hit) continue;
  const code = `${hit[0]}:${hit[1]}`;
  // What the name itself says: an item the rules place only by its number counts as queued, or the table would
  // confirm itself.
  const decision = decideStorefrontCategory({ groupNames: [], productName: item.name });
  const slug = decision.source === "number" ? QUEUE : decision.slug;
  const entry = codes.get(code) ?? { examples: [], queued: [], shelves: new Map() };
  entry.shelves.set(slug, (entry.shelves.get(slug) ?? 0) + 1);
  (slug === QUEUE ? entry.queued : entry.examples).push(oneLine(item.name));
  codes.set(code, entry);
}
const rows = [];
for (const [code, entry] of codes) {
  const placed = [...entry.shelves].filter(([slug]) => slug !== QUEUE).sort((a, b) => b[1] - a[1]);
  const total = placed.reduce((sum, [, count]) => sum + count, 0);
  if (total < minPlaced || !placed[0] || placed[0][1] / total < minShare) continue;
  rows.push({ agree: placed[0][1], code, examples: entry.examples, placed: total, queued: entry.queued.length, queuedExamples: entry.queued, slug: placed[0][0] });
}
rows.sort((a, b) => b.queued - a.queued || b.placed - a.placed);
for (const row of rows) {
  console.log(`${row.code}\t${row.slug}\t${row.agree}/${row.placed}\tqueued ${row.queued}\t${row.examples[0].slice(0, 58)}${row.queuedExamples[0] ? `  ¦  ${row.queuedExamples[0].slice(0, 44)}` : ""}`);
  for (const example of [...row.examples.slice(1, examplesPerCode), ...row.queuedExamples.slice(1, examplesPerCode)]) console.log(`\t\t\t\t${example.slice(0, 104)}`);
}
console.error(`codes: ${rows.length} | queued items they settle: ${rows.reduce((sum, row) => sum + row.queued, 0)}`);
