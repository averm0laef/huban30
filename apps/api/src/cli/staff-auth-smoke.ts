import { Client } from "pg";

import { validateEnvironment } from "../config.js";
import { TotpService } from "../security/totp.service.js";

interface JsonResponse {
  [key: string]: unknown;
}

async function main(): Promise<void> {
  const environment = validateEnvironment(process.env);
  if (!environment.AUTH_DEBUG_TOKENS || !environment.APP_ORIGIN.startsWith("http://localhost")) {
    throw new Error("Staff auth smoke is restricted to the local debug environment");
  }

  const apiBase = "http://127.0.0.1:4000/api/v1";
  const ownerEmail = "owner-smoke@example.invalid";
  const ownerPassword = "Owner smoke password phrase 2026";
  const managerEmail = `manager-smoke-${Date.now()}@example.invalid`;
  const managerPassword = "Manager smoke password phrase 2026";
  const cookies = new Map<string, string>();
  const totp = new TotpService();

  const request = async (
    path: string,
    init: RequestInit,
    expectedStatus: number,
  ): Promise<JsonResponse> => {
    const headers = new Headers(init.headers);
    if (cookies.size > 0) {
      headers.set("cookie", [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; "));
    }
    const response = await fetch(`${apiBase}${path}`, { ...init, headers });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";", 1);
      const separator = pair?.indexOf("=") ?? -1;
      if (pair && separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    const body = response.status === 204 ? {} : await response.json() as JsonResponse;
    if (response.status !== expectedStatus) {
      throw new Error(`${path} returned ${response.status}, expected ${expectedStatus}: ${JSON.stringify(body)}`);
    }
    return body;
  };

  const post = (path: string, body: unknown, expectedStatus: number, csrf?: string) => request(path, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: environment.APP_ORIGIN,
      ...(csrf ? { "x-csrf-token": csrf } : {}),
    },
    method: "POST",
  }, expectedStatus);

  let smokeError: unknown;
  try {
    const ownerLogin = await post("/auth/login", { email: ownerEmail, password: ownerPassword }, 201);
    let csrf = String(ownerLogin.csrfToken ?? "");
    if (ownerLogin.role !== "admin" || ownerLogin.totpSetupRequired !== true) {
      throw new Error("Owner must enter a TOTP-limited admin session");
    }
    await post("/auth/staff/invitations", { email: managerEmail, role: "manager" }, 401, csrf);

    const ownerSetup = await post("/auth/totp/setup", {}, 201, csrf);
    const ownerSecret = String(ownerSetup.secret ?? "");
    const ownerConfirmed = await post(
      "/auth/totp/confirm",
      { code: totp.generateCode(ownerSecret) },
      201,
      csrf,
    );
    csrf = String(ownerConfirmed.csrfToken ?? "");
    if (!Array.isArray(ownerConfirmed.recoveryCodes) || ownerConfirmed.recoveryCodes.length !== 10) {
      throw new Error("Owner recovery code contract is invalid");
    }

    const invitation = await post(
      "/auth/staff/invitations",
      { email: managerEmail, role: "manager" },
      201,
      csrf,
    );
    const invitationToken = String(invitation.developmentToken ?? "");
    if (!invitationToken) throw new Error("Development staff invitation token is missing");

    cookies.clear();
    await post("/auth/staff/invitations/accept", {
      displayName: "Manager Smoke",
      password: managerPassword,
      token: invitationToken,
    }, 201);
    const managerLogin = await post(
      "/auth/login",
      { email: managerEmail, password: managerPassword },
      201,
    );
    csrf = String(managerLogin.csrfToken ?? "");
    const managerSetup = await post("/auth/totp/setup", {}, 201, csrf);
    const managerConfirmed = await post(
      "/auth/totp/confirm",
      { code: totp.generateCode(String(managerSetup.secret ?? "")) },
      201,
      csrf,
    );
    csrf = String(managerConfirmed.csrfToken ?? "");
    await post(
      "/auth/staff/invitations",
      { email: "forbidden-smoke@example.invalid", role: "manager" },
      403,
      csrf,
    );
    await post("/auth/logout", {}, 204, csrf);
  } catch (error) {
    smokeError = error;
  }

  let cleanupError: unknown;
  const client = new Client({ connectionString: environment.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const accounts = await client.query<{ email: string; id: string }>(
      `
        SELECT id, email::text
        FROM app.users
        WHERE email = $1 OR email = $2
      `,
      [ownerEmail, managerEmail],
    );
    const accountIds = accounts.rows.map(({ id }) => id);
    await client.query(
      `DELETE FROM app.outbox_events
       WHERE payload->>'recipient' = $1 OR payload->>'recipient' = $2`,
      [ownerEmail, managerEmail],
    );
    await client.query(
      "DELETE FROM app.staff_invitations WHERE email = $1 OR email = $2",
      [ownerEmail, managerEmail],
    );
    for (const account of accounts.rows) {
      await client.query("DELETE FROM app.auth_sessions WHERE user_id = $1", [account.id]);
      await client.query("DELETE FROM app.staff_recovery_codes WHERE user_id = $1", [account.id]);
      await client.query("DELETE FROM app.staff_members WHERE user_id = $1", [account.id]);
      await client.query(
        `
          UPDATE app.users
          SET email = 'deleted+' || id::text || '@example.invalid',
              display_name = 'Removed staff auth smoke account',
              password_hash = NULL,
              status = 'disabled',
              session_invalid_before = clock_timestamp(),
              deleted_at = clock_timestamp()
          WHERE id = $1
        `,
        [account.id],
      );
    }
    await client.query(
      "DELETE FROM app.auth_attempts WHERE email = $1 OR email = $2",
      [ownerEmail, managerEmail],
    );
    await client.query("COMMIT");
    if (accountIds.length !== 2) {
      cleanupError = new Error(`Expected two staff smoke accounts, found ${accountIds.length}`);
    }
  } catch (error) {
    await client.query("ROLLBACK");
    cleanupError = error;
  } finally {
    await client.end();
  }

  if (smokeError) throw smokeError;
  if (cleanupError) throw cleanupError;
  process.stdout.write(JSON.stringify({ event: "staff-auth.smoke.passed", tests: 10 }) + "\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Staff auth smoke failed"}\n`);
  process.exitCode = 1;
});
