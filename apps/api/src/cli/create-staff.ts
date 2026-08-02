import { readFileSync } from "node:fs";

import { Client } from "pg";
import { z } from "zod";

import { RoleSchema } from "@an30/contracts";
import { validateEnvironment } from "../config.js";
import { PasswordService } from "../security/password.service.js";

/**
 * Creates a staff account directly, for development and staging only.
 *
 * Production staff are added through the invitation flow, which requires an
 * authenticated admin and a one-time token delivered by email. That path keeps
 * an accountable trail, so this shortcut refuses to run against a production
 * deployment: a container command that mints privileged accounts must not exist
 * where real customer data lives.
 *
 * TOTP is still mandatory. The account is created without an enrolled factor,
 * so the first sign-in goes through the normal mandatory TOTP setup.
 *
 *   node dist/cli/create-staff.js --email m@an30.ru --display-name "Менеджер" \
 *     --role manager --password-file /run/secrets/pw
 */
const argumentsSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  passwordFile: z.string().min(1),
  role: RoleSchema.exclude(["customer"]),
});

function readArguments(argv: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error("Invalid staff CLI arguments");
    values.set(key.slice(2), value);
  }
  return argumentsSchema.parse({
    displayName: values.get("display-name"),
    email: values.get("email"),
    passwordFile: values.get("password-file"),
    role: values.get("role"),
  });
}

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

async function main(): Promise<void> {
  const input = readArguments(process.argv.slice(2));
  const password = readFileSync(input.passwordFile, "utf8").replace(/[\r\n]+$/u, "");
  if (password.length < 12 || password.length > 128) {
    throw new Error("Staff password must contain between 12 and 128 characters");
  }

  const environment = validateEnvironment(process.env);
  if (environment.DEPLOYMENT_ENVIRONMENT === "production") {
    throw new Error("Direct staff creation is not allowed in production; use an invitation");
  }

  const client = new Client({ connectionString: environment.DATABASE_URL });
  await client.connect();

  try {
    await client.query("BEGIN");
    // The database carries its own immutable environment label, so a mislabelled
    // container cannot be used to slip a privileged account into production.
    const marker = (await client.query<{ environment: string }>(
      "SELECT environment FROM app.deployment_settings LIMIT 1",
    )).rows[0];
    if (marker?.environment === "production") {
      throw new Error("Database is marked production; direct staff creation is refused");
    }

    const passwordHash = await new PasswordService().hash(password);
    const account = (await client.query<{ id: string }>(
      `INSERT INTO app.users (email, display_name, password_hash, status, email_verified_at, password_changed_at)
       VALUES ($1, $2, $3, 'active', clock_timestamp(), clock_timestamp())
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         status = 'active',
         email_verified_at = COALESCE(app.users.email_verified_at, clock_timestamp()),
         password_changed_at = clock_timestamp()
       RETURNING id`,
      [input.email, input.displayName.normalize("NFKC").trim(), passwordHash],
    )).rows[0];
    const userId = account?.id;
    if (!userId) throw new Error("Staff account did not return an identifier");

    await client.query(
      `INSERT INTO app.staff_members (user_id, role, status)
       VALUES ($1, $2::app.app_role, 'active')
       ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active'`,
      [userId, input.role],
    );
    await client.query(
      `INSERT INTO app.audit_log (actor_user_id, actor_role, action, entity_type, entity_id, metadata)
       VALUES ($1::uuid, $2::app.app_role, 'staff.created_by_cli', 'staff_member', $1::text,
         '{"source":"container_cli","totp_required":true}'::jsonb)`,
      [userId, input.role],
    );
    await client.query("COMMIT");
    process.stdout.write(
      `Staff ${maskEmail(input.email)} (${input.role}) ready. TOTP setup is mandatory on first login.\n`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Staff creation failed"}\n`);
  process.exitCode = 1;
});
