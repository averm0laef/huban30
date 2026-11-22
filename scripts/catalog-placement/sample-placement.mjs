// A fixed random sample of the export with the shelf each item gets: the list a person reads through, line by line,
// to measure how often the rules are right. The same size and seed always pick the same items.
// Usage: node scripts/catalog-placement/sample-placement.mjs [size] [seed]
// Writes local-data/1c/sample-<size>-seed<seed>.tsv. A sample that is already there is never overwritten (it is the
// record of what was read): the re-run goes to …-rerun.tsv and the rows whose shelf changed since are printed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { DATA_DIR, LABELS, loadItems, oneLine, place, QUEUE } from "./lib.mjs";

const NO_SECTION = "— без раздела —";
const size = Number(process.argv[2] ?? 300);
const firstSeed = Number(process.argv[3] ?? 20261122);
let seed = firstSeed;
const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const items = loadItems();
const picked = new Set();
while (picked.size < size) picked.add(Math.floor(random() * items.length));
const rows = [...picked].sort((a, b) => a - b).map((index, n) => {
  const item = items[index];
  const { slug } = place(item);
  return [String(n + 1), slug === QUEUE ? NO_SECTION : LABELS.get(slug) ?? slug, oneLine(item.name), item.sku];
});
const text = rows.map((cells) => cells.join("\t")).join("\n") + "\n";
const queued = rows.filter((cells) => cells[1] === NO_SECTION).length;
const target = `${DATA_DIR}sample-${size}-seed${firstSeed}.tsv`;
if (!existsSync(target)) {
  writeFileSync(target, text);
  console.log(`rows: ${rows.length} | without a section: ${queued} | written: ${target}`);
} else {
  const before = readFileSync(target, "utf8").split("\n").filter(Boolean).map((row) => row.split("\t"));
  const rerun = target.replace(/\.tsv$/u, "-rerun.tsv");
  writeFileSync(rerun, text);
  const moved = rows.filter((cells, index) => before[index]?.[2] === cells[2] && before[index][1] !== cells[1]);
  console.log(`rows: ${rows.length} | without a section: ${queued} | the sample read earlier is kept; this run: ${rerun}`);
  console.log(`shelf changed since: ${moved.length}`);
  for (const cells of moved) console.log(`  ${cells[0].padStart(3)}  ${before[Number(cells[0]) - 1][1]}  →  ${cells[1]}  |  ${cells[2].slice(0, 80)}`);
}
