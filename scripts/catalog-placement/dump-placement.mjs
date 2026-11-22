// Writes «code <TAB> shelf <TAB> source <TAB> name» for every item of the export. Two dumps, made before and after a
// change of the rules, show exactly which items moved: python3 scripts/catalog-placement/diff-placement.py before after
// Usage: node scripts/catalog-placement/dump-placement.mjs <output file>
import { writeFileSync } from "node:fs";

import { loadItems, oneLine, place } from "./lib.mjs";

const output = process.argv[2];
if (!output) {
  console.error("Usage: node scripts/catalog-placement/dump-placement.mjs <output file>");
  process.exit(1);
}
const items = loadItems();
writeFileSync(output, items.map((item) => {
  const { slug, source } = place(item);
  return [item.code, slug, source, oneLine(item.name)].join("\t");
}).join("\n") + "\n");
console.log("items:", items.length);
