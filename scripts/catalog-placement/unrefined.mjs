// The items that got a section but no subsection: how many per section, and a few names of each.
// Usage: node scripts/catalog-placement/unrefined.mjs [names per section]
import { loadItems, oneLine, place, QUEUE, SECTION_LABELS } from "./lib.mjs";

const limit = Number(process.argv[2] ?? 6);
const bySection = new Map();
let placed = 0;
for (const item of loadItems()) {
  const { slug } = place(item);
  if (slug !== QUEUE) placed += 1;
  if (SECTION_LABELS.has(slug)) bySection.set(slug, [...(bySection.get(slug) ?? []), oneLine(item.name)]);
}
const total = [...bySection.values()].reduce((sum, list) => sum + list.length, 0);
console.log(`placed: ${placed} | in a section without a subsection: ${total} (${(total / placed * 100).toFixed(1)} % of the placed)`);
for (const [slug, list] of [...bySection].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`=== ${SECTION_LABELS.get(slug)}: ${list.length}`);
  const step = Math.max(1, Math.floor(list.length / limit));
  for (let index = 0; index < list.length && index / step < limit; index += step) console.log("   ", list[index].slice(0, 104));
}
