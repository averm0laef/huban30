#!/usr/bin/env node
// How many products of the owner's export get a brand from the maker written in the name, and which makers.
//   corepack pnpm --filter @an30/api build && node scripts/catalog-placement/makers-in-names.mjs [examples per maker]
import { partMakerInName } from "../../apps/api/dist/catalog/catalog-part-makers.js";
import { loadItems } from "./lib.mjs";

const examples = Number(process.argv[2] ?? 0);
const items = loadItems();
const byMaker = new Map();
for (const item of items) {
  const maker = partMakerInName(item.name);
  if (!maker) continue;
  const entry = byMaker.get(maker) ?? { count: 0, names: [] };
  entry.count += 1;
  if (entry.names.length < examples) entry.names.push(item.name);
  byMaker.set(maker, entry);
}
const total = [...byMaker.values()].reduce((sum, entry) => sum + entry.count, 0);
console.log(`${total} of ${items.length} products get a brand from the name (${(total * 100 / items.length).toFixed(1)} %), ${byMaker.size} makers`);
for (const [maker, entry] of [...byMaker].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`${String(entry.count).padStart(6)}  ${maker}`);
  for (const name of entry.names) console.log(`          ${name.slice(0, 110)}`);
}
