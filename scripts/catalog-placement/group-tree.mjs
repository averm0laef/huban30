// How the shop's rules read the names of the 1С groups: for every group of the tree, the section a product lying
// directly in it would get from the groups alone — the group's own name read together with its parents', the way
// the exchange reads them. «own» means the group's name alone gives the same answer, «chain» that the parents
// were needed, «none» that the groups say nothing and the product's own name has to decide.
// The tree is a text file with two spaces of indent per level (local-data/1c/groups-tree-*.txt, read off the 1С
// screen; the list export carries no groups).
// Usage: node scripts/catalog-placement/group-tree.mjs [own|chain|none|all]     (default: a summary and «none»)
import { readdirSync, readFileSync } from "node:fs";

import { decideStorefrontCategory } from "../../apps/api/dist/catalog/catalog-known-categories.js";
import { DATA_DIR, LABELS, QUEUE } from "./lib.mjs";

const show = process.argv[2] ?? "none";
const file = process.env.AN30_1C_GROUPS_TREE ?? `${DATA_DIR}${readdirSync(DATA_DIR).filter((name) => /^groups-tree-.*\.txt$/u.test(name)).sort().at(-1)}`;
const lines = readFileSync(file, "utf8").split("\n").filter((line) => line.trim() && !/^<.*»$/u.test(line.trim()));
const stack = [];
const groups = lines.map((line) => {
  const depth = (line.length - line.trimStart().length) / 2;
  const name = line.trim();
  stack.length = depth;
  const chain = [name, ...[...stack].reverse()];
  stack.push(name);
  return { chain, depth, name };
});
const sectionOf = (names) => decideStorefrontCategory({ groupNames: names, productName: "" }).slug;
const rows = groups.map((group) => {
  const slug = sectionOf(group.chain);
  return { ...group, how: slug === QUEUE ? "none" : sectionOf([group.name]) === slug ? "own" : "chain", slug };
});
const count = (how) => rows.filter((row) => row.how === how).length;
console.log(`groups: ${rows.length} | section by the group's own name: ${count("own")} | with the parents' names: ${count("chain")} | none: ${count("none")}`);
for (const row of rows) {
  if (show !== "all" && row.how !== show) continue;
  const path = [...row.chain].reverse().join(" / ");
  console.log(`${row.how.padEnd(6)} ${(row.slug === QUEUE ? "—" : LABELS.get(row.slug) ?? row.slug).padEnd(46)} ${path.slice(0, 90)}`);
}
