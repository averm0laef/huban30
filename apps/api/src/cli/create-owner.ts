import { readFileSync } from "node:fs";

import { Client } from "pg";
import { z } from "zod";

import { validateEnvironment } from "../config.js";
import { PasswordService } from "../security/password.service.js";

const argumentsSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  email: z.email().transform((value) => value.trim().toLowerCase()),
  passwordFile: z.string().min(1),
});

function readArguments(argv: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error("Invalid owner CLI arguments");
    values.set(key.slice(2), value);
  }
  return argumentsSchema.parse({
    displayName: values.get("display-name"),
    email: values.get("email"),
    passwordFile: values.get("password-file"),
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
    throw new Error("Owner password must contain between 12 and 128 characters");
  }
  const environment = validateEnvironment(process.env);
  const client = new Client({ connectionString: environment.DATABASE_URL });
  await client.connect();

  try {
    await client.query("BEGIN");
    const existingStaff = await client.query<{ email: string; role: string }>(
      `
        SELECT account.email::text, staff.role::text
        FROM app.staff_members AS staff
        JOIN app.users AS account ON account.id = staff.user_id
        FOR UPDATE
      `,
    );
    const currentOwner = existingStaff.rows.find(
      (row) => row.email.toLowerCase() === input.email && row.role === "admin",
    );
    if (currentOwner) {
      await client.query("ROLLBACK");
      process.stdout.write(`Owner ${maskEmail(input.email)} is already initialized.\n`);
      return;
    }
    if (existingStaff.rowCount) {
      throw new Error("Owner bootstrap is locked because staff accounts already exist");
    }

    const passwordHash = await new PasswordService().hash(password);
    const account = await client.query<{ id: string }>(
      `
        INSERT INTO app.users (
          email, display_name, password_hash, status, email_verified_at, password_changed_at
        ) VALUES ($1, $2, $3, 'active', clock_timestamp(), clock_timestamp())
        RETURNING id
      `,
      [input.email, input.displayName.normalize("NFKC").trim(), passwordHash],
    );
    const userId = account.rows[0]?.id;
    if (!userId) throw new Error("Owner account did not return an identifier");
    await client.query(
      `INSERT INTO app.staff_members (user_id, role, status) VALUES ($1, 'admin', 'active')`,
      [userId],
    );
    await client.query(
      `
        INSERT INTO app.audit_log (actor_user_id, actor_role, action, entity_type, entity_id, metadata)
        VALUES ($1::uuid, 'admin', 'owner.bootstrap.created', 'staff_member', $1::text,
          '{"source":"container_cli","totp_required":true}'::jsonb)
      `,
      [userId],
    );
    await client.query("COMMIT");
    process.stdout.write(
      `Owner ${maskEmail(input.email)} created. TOTP setup is mandatory on first login.\n`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Owner bootstrap failed"}\n`);
  process.exitCode = 1;
});
