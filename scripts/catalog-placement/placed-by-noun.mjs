// Where the names about the given nouns go now: a count per shelf and a few names of each shelf to look at.
// Usage: node scripts/catalog-placement/placed-by-noun.mjs <names per shelf> <noun> [noun…]
import { partHeadNoun } from "../../apps/api/dist/catalog/catalog-part-dictionary.js";
import { LABELS, loadItems, oneLine, place } from "./lib.mjs";

const [limit, ...nouns] = process.argv.slice(2);
const shelves = new Map();
for (const item of loadItems()) {
  const head = partHeadNoun(item.name) ?? "";
  if (!nouns.some((noun) => head.startsWith(noun))) continue;
  const { slug } = place(item);
  shelves.set(slug, [...(shelves.get(slug) ?? []), oneLine(item.name)]);
}
for (const [slug, list] of [...shelves].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`=== ${LABELS.get(slug) ?? slug}: ${list.length}`);
  const step = Math.max(1, Math.floor(list.length / Number(limit)));
  for (let index = 0; index < list.length && index / step < Number(limit); index += step) console.log("   ", list[index].slice(0, 100));
}
