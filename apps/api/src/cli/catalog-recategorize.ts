// Re-sorts every product into the storefront section tree (one transaction)
// and prints how many products each section holds afterwards.
//
//   node dist/cli/catalog-recategorize.js            apply
//   node dist/cli/catalog-recategorize.js --dry-run  show the result, change nothing
//
// Same rules as the 1С exchange and the admin button «Разложить товары
// заново»: staff mapping of the 1С group → group names → product name →
// «Без категории». See catalog/catalog-recategorize.service.ts.
import { Client } from "pg";

import { CatalogRecategorizeService } from "../catalog/catalog-recategorize.service.js";
import { validateEnvironment } from "../config.js";
import type { DatabaseService } from "../infrastructure/database.service.js";

class DryRunRollback extends Error {
  constructor(readonly result: unknown) { super("dry run"); }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const environment = validateEnvironment(process.env);
  const client = new Client({ connectionString: environment.DATABASE_URL });
  await client.connect();
  const database = {
    query: (text: string, values?: unknown[]) => client.query(text, values),
    transaction: async <T>(work: (connection: Client) => Promise<T>): Promise<T> => {
      await client.query("BEGIN");
      try {
        const result = await work(client);
        if (dryRun) throw new DryRunRollback(result);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        if (error instanceof DryRunRollback) return error.result as T;
        throw error;
      }
    },
  } as unknown as DatabaseService;
  try {
    const report = await new CatalogRecategorizeService(database).recategorizeAll();
    process.stdout.write(`${dryRun ? "Проверка без изменений" : "Готово"}: товаров ${report.total}, перенесено ${report.moved}, `
      + `отключено пустых разделов из групп 1С ${report.deactivatedGroupCategories}.\n`);
    for (const section of report.perSection) {
      process.stdout.write(`  ${String(section.count).padStart(6)}  ${section.label} (${section.slug})\n`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
