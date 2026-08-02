import { readFileSync } from "node:fs";

import { Client } from "pg";
import { z } from "zod";

import { validateEnvironment } from "../config.js";
import { PasswordService } from "../security/password.service.js";

/**
 * Container-only password reset for an existing account.
 *
 * The owner bootstrap command refuses to touch an account that already exists,
 * so a forgotten staff password would otherwise require direct SQL. This tool
 * performs the same Argon2id hashing the API uses, revokes every live session
 * so a stolen cookie cannot outlive the reset, and records the change in the
 * append-only audit log.
 *
 * It reads the new password from a file rather than argv, because process
 * arguments are visible to every process on the host.
 *
 *   node dist/cli/reset-password.js --email owner@an30.ru --password-file /run/secrets/new
 */
const argumentsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  passwordFile: z.string().min(1),
  verifyEmail: z.enum(["true", "false"]).default("false"),
});

function readArguments(argv: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error("Invalid reset CLI arguments");
    values.set(key.slice(2), value);
  }
  return argumentsSchema.parse({
    email: values.get("email"),
    passwordFile: values.get("password-file"),
    verifyEmail: values.get("verify-email") ?? "false",
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
    throw new Error("Password must contain between 12 and 128 characters");
  }

  const environment = validateEnvironment(process.env);
  const client = new Client({ connectionString: environment.DATABASE_URL });
  await client.connect();

  try {
    await client.query("BEGIN");
    const account = (await client.query<{ id: string; role: string | null }>(
      `SELECT account.id, staff.role::text AS role
       FROM app.users AS account
       LEFT JOIN app.staff_members AS staff ON staff.user_id = account.id
       WHERE account.email = $1 AND account.deleted_at IS NULL
       FOR UPDATE OF account`,
      [input.email],
    )).rows[0];
    if (!account) throw new Error("Account not found");

    const passwordHash = await new PasswordService().hash(password);
    // A reset also clears a pending email confirmation when asked, because an
    // unverified account cannot sign in and the operator is proving control of
    // it from inside the container.
    await client.query(
      `UPDATE app.users SET
         password_hash = $2,
         password_changed_at = clock_timestamp(),
         status = CASE WHEN $3::boolean THEN 'active'::app.user_status ELSE status END,
         email_verified_at = CASE
           WHEN $3::boolean THEN COALESCE(email_verified_at, clock_timestamp())
           ELSE email_verified_at END,
         failed_login_count = 0,
         locked_until = NULL
       WHERE id = $1`,
      [account.id, passwordHash, input.verifyEmail === "true"],
    );
    const revoked = await client.query(
      `UPDATE app.auth_sessions
       SET revoked_at = clock_timestamp(), revoke_reason = 'password_changed'
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [account.id],
    );
    await client.query(
      `UPDATE app.password_reset_tokens SET used_at = clock_timestamp()
       WHERE user_id = $1 AND used_at IS NULL`,
      [account.id],
    );
    await client.query(
      `INSERT INTO app.audit_log (actor_user_id, actor_role, action, entity_type, entity_id, metadata)
       VALUES ($1::uuid, $2::app.app_role, 'account.password.reset_by_operator', 'user', $1::text,
         '{"source":"container_cli"}'::jsonb)`,
      [account.id, account.role ?? "admin"],
    );
    await client.query("COMMIT");
    process.stdout.write(
      `Password reset for ${maskEmail(input.email)}. ${revoked.rowCount ?? 0} session(s) revoked.\n`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Password reset failed"}\n`);
  process.exitCode = 1;
});
