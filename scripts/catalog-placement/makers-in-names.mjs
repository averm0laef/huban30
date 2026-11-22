#!/usr/bin/env node
// How many products of the owner's export get a brand from the maker written in the name, and which makers.
//   corepack pnpm --filter @an30/api build && node scripts/catalog-placement/makers-in-names.mjs [examples per maker] [--candidates N]
// With --candidates: the Latin words most often met in names that got no brand — the makers the list may still lack.
// Each one is read by eye before it goes into catalog-part-makers.ts: makes of cars, words of a trade and engine
// codes are not makers.
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

const candidatesAt = process.argv.indexOf("--candidates");
if (candidatesAt !== -1) {
  const top = Number(process.argv[candidatesAt + 1] ?? 60);
  const words = new Map();
  for (const item of items) {
    if (partMakerInName(item.name)) continue;
    // Words in brackets are an analogue's number, not the maker (catalog-part-makers.ts).
    const outside = item.name.replace(/\([^)]*\)/gu, " ");
    const seen = new Set(outside.match(/(?<![\p{L}\p{N}])[A-Za-z][A-Za-z&'-]{2,}(?![\p{L}\p{N}])/gu) ?? []);
    for (const word of seen) {
      const key = word.toUpperCase();
      const entry = words.get(key) ?? { count: 0, example: item.name };
      entry.count += 1;
      words.set(key, entry);
    }
  }
  console.log(`\nLatin words of names without a brand, most frequent first:`);
  for (const [word, entry] of [...words].sort((a, b) => b[1].count - a[1].count).slice(0, top)) {
    console.log(`${String(entry.count).padStart(6)}  ${word.padEnd(14)} ${entry.example.slice(0, 90)}`);
  }
}
