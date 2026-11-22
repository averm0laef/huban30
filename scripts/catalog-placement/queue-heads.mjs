// The queue «Без категории» by the noun each name is about: what to teach the dictionary next.
// Usage: node scripts/catalog-placement/queue-heads.mjs [how many groups] [examples per group]
import { partHeadNoun } from "../../apps/api/dist/catalog/catalog-part-dictionary.js";
import { loadItems, oneLine, place, QUEUE } from "./lib.mjs";

const top = Number(process.argv[2] ?? 100);
const examples = Number(process.argv[3] ?? 2);
const items = loadItems();
const groups = new Map();
let queued = 0;
for (const item of items) {
  if (place(item).slug !== QUEUE) continue;
  queued += 1;
  const head = partHeadNoun(item.name) ?? "(нет русского слова)";
  groups.set(head, [...(groups.get(head) ?? []), item.name]);
}
console.log(`names: ${items.length} | in the queue: ${queued} (${(queued / items.length * 100).toFixed(1)} %) | different nouns: ${groups.size}`);
for (const [head, list] of [...groups].sort((a, b) => b[1].length - a[1].length).slice(0, top)) {
  console.log(String(list.length).padStart(5), head.padEnd(18), list.slice(0, examples).map((name) => oneLine(name).slice(0, 62)).join("  ¦  "));
}
