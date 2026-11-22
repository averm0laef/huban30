// How the storefront shows the names of the export: publicProductName with the article
// (packages/contracts/src/product-name.ts) against the name as 1С has it. Prints how many names each rule changes
// and examples to read by eye; nothing is written.
// Usage: node scripts/catalog-placement/shown-names.mjs [examples per rule]
import { publicProductName } from "../../packages/contracts/dist/index.js";

import { loadItems, oneLine } from "./lib.mjs";

const examples = Number(process.argv[2] ?? 5);
const rules = { article: [], capital: [], repeat: [], notes: [] };
let changed = 0;
const items = loadItems();
for (const item of items) {
  const typed = oneLine(item.name ?? "");
  if (!typed) continue;
  const stored = publicProductName(typed);
  const shown = publicProductName(typed, item.sku ?? "");
  if (stored !== typed) rules.notes.push(`${typed} → ${stored}`);
  if (shown === stored) continue;
  changed += 1;
  const line = `[${item.sku}] ${stored} → ${shown}`;
  const sku = String(item.sku ?? "").trim().toLowerCase();
  if (sku && stored.toLowerCase().startsWith(`${sku} `) && !shown.toLowerCase().startsWith(`${sku} `)) rules.article.push(line);
  else if (stored.split(" ").length > shown.split(" ").length) rules.repeat.push(line);
  else rules.capital.push(line);
}
console.log(`items: ${items.length}; the storefront shows another name for ${changed}`);
for (const [rule, lines] of Object.entries(rules)) {
  console.log(`\n${rule}: ${lines.length}`);
  const step = Math.max(1, Math.floor(lines.length / Math.max(1, examples)));
  for (const line of lines.filter((_, index) => index % step === 0).slice(0, examples)) console.log(`  ${line}`);
}
