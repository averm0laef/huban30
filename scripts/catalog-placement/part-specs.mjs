// What the names of the export say about the parts (apps/api/src/catalog/catalog-part-specs.ts): how many names
// give each feature, examples to read by eye, and how many standard sizes are shared by several items — the
// «Тот же типоразмер» a product page can offer. Reads the built API (corepack pnpm --filter @an30/api build).
// Usage: node scripts/catalog-placement/part-specs.mjs [examples per feature]
import { partSizeKey, partSpecs } from "../../apps/api/dist/catalog/catalog-part-specs.js";

import { loadItems, oneLine } from "./lib.mjs";

const examples = Number(process.argv[2] ?? 4);
const byFeature = new Map();
const sizes = new Map();
const items = loadItems();
for (const item of items) {
  const name = oneLine(item.name ?? "");
  const specs = partSpecs(name);
  for (const [key, value] of Object.entries(specs)) {
    const list = byFeature.get(key) ?? [];
    list.push(`${value} ← ${name.slice(0, 90)}`);
    byFeature.set(key, list);
  }
  const size = partSizeKey(specs);
  if (size) sizes.set(size, [...(sizes.get(size) ?? []), name]);
}
console.log(`items: ${items.length}`);
for (const [key, list] of [...byFeature].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${key}: ${list.length}`);
  const step = Math.max(1, Math.floor(list.length / Math.max(1, examples)));
  for (const line of list.filter((_, index) => index % step === 0).slice(0, examples)) console.log(`  ${line}`);
}
const shared = [...sizes].filter(([, names]) => names.length > 1);
console.log(`\nstandard sizes: ${sizes.size}, shared by several items: ${shared.length} (${shared.reduce((sum, [, names]) => sum + names.length, 0)} items)`);
for (const [size, names] of shared.sort((a, b) => b[1].length - a[1].length).slice(0, examples)) console.log(`  ${size}: ${names.length} — ${names.slice(0, 3).map((name) => name.slice(0, 50)).join(" | ")}`);
