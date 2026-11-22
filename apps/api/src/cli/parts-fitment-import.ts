import { readFileSync } from "node:fs";

import { Client } from "pg";

import { validateEnvironment } from "../config.js";
import { parseFitmentCsv } from "../parts-finder/engine/fitment.js";
import { CATEGORY_NAMES } from "../parts-finder/engine/vehicle-parts.js";
import { replaceFitment } from "../parts-finder/parts-finder.stores.js";

/**
 * Imports the shop's fitment table for «Подбор по автомобилю» (docs/PARTS_FINDER.md).
 *
 *   node dist/cli/parts-fitment-import.js /path/fitment.csv [--dry-run]
 *
 * UTF-8 CSV with the header
 *   make,model,category,configuration,engine,liters,year_from,year_to,article,brand,oem,source
 * Every row is validated first; the import then replaces the whole set in one
 * transaction (a failed import leaves the previous set untouched). Articles
 * are stored as text, so leading zeros survive. --dry-run validates and rolls back.
 */
async function main(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const files = argv.filter((value) => value !== "--dry-run");
  if (files.length !== 1) {
    throw new Error("Использование: node dist/cli/parts-fitment-import.js fitment.csv [--dry-run]");
  }
  const rows = parseFitmentCsv(readFileSync(files[0]!, "utf8"), CATEGORY_NAMES);
  const environment = validateEnvironment(process.env);
  const client = new Client({ connectionString: environment.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const count = await replaceFitment(client, rows);
    if (dryRun) {
      await client.query("ROLLBACK");
      process.stdout.write(`Проверено строк применимости: ${count}. База не изменена (--dry-run).\n`);
    } else {
      await client.query("COMMIT");
      process.stdout.write(`Загружено строк применимости: ${count}\n`);
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
