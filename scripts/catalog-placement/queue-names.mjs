// The queued names whose noun starts with one of the given words: the real names to write tests from.
// Usage: node scripts/catalog-placement/queue-names.mjs <how many per noun> <noun> [noun…]
import { partHeadNoun } from "../../apps/api/dist/catalog/catalog-part-dictionary.js";
import { loadItems, oneLine, place, QUEUE } from "./lib.mjs";

const [limit, ...nouns] = process.argv.slice(2);
const found = new Map(nouns.map((noun) => [noun, []]));
for (const item of loadItems()) {
  const head = partHeadNoun(item.name) ?? "";
  const noun = nouns.find((candidate) => head.startsWith(candidate));
  if (noun && place(item).slug === QUEUE) found.get(noun).push(oneLine(item.name));
}
for (const [noun, list] of found) {
  console.log(`=== ${noun}: ${list.length}`);
  const step = Math.max(1, Math.floor(list.length / Number(limit)));
  for (let index = 0; index < list.length && index / step < Number(limit); index += step) console.log("   ", list[index].slice(0, 105));
}
