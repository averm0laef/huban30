// Shows how the shop's own rules would sort a 1С assortment into the
// storefront sections — before any exchange, without a database and without
// touching 1С. Reads a file only:
//
//   node dist/cli/catalog-placement-audit.js import.xml        CommerceML export («Товары»), with its groups
//   node dist/cli/catalog-placement-audit.js goods.csv         one product per line: name, or article;brand;name
//
// An exchange file is read by the exchange's own parser and placed by the
// exchange's own function, so the answer is what the first exchange would
// decide: items per section, what decided (1С group, name, original number),
// where every 1С group points, and the words the unsorted names are about.
// The logic lives in src/catalog/catalog-placement-audit.ts.
import { readFileSync } from "node:fs";

import { auditPlacement, formatAudit, readCommerceMl, readList } from "../catalog/catalog-placement-audit.js";

function main(): void {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write("Укажите файл: выгрузку CommerceML (import.xml) или список товаров (CSV, по одному в строке).\n");
    process.exitCode = 1;
    return;
  }
  const text = readFileSync(file, "utf8").replace(/^\uFEFF/u, "");
  const input = text.includes("<КоммерческаяИнформация") ? readCommerceMl(text) : readList(text);
  if (input.items.length === 0) {
    process.stderr.write("В файле не найдено ни одного товара.\n");
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${formatAudit(auditPlacement(input)).join("\n")}\n`);
}

main();
