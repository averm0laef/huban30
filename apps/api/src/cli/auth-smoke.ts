import { Client } from "pg";

import { REGISTRATION_PERSONAL_DATA_CONSENT_VERSION } from "@an30/contracts";

import { validateEnvironment } from "../config.js";

interface JsonResponse {
  [key: string]: unknown;
}

async function main(): Promise<void> {
  const environment = validateEnvironment(process.env);
  if (!environment.AUTH_DEBUG_TOKENS || !environment.APP_ORIGIN.startsWith("http://localhost")) {
    throw new Error("Auth smoke is restricted to the local debug environment");
  }

  const apiBase = "http://127.0.0.1:4000/api/v1";
  const email = `auth-smoke-${Date.now()}@example.invalid`;
  const originalPassword = "Smoke-only password phrase 2026";
  const replacementPassword = "Replacement smoke phrase 2026";
  const cookies = new Map<string, string>();
  let createdUserId: string | undefined;

  const request = async (
    path: string,
    init: RequestInit,
    expectedStatus: number,
  ): Promise<{ body: JsonResponse; response: Response }> => {
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
    const body = response.status === 204
      ? {}
      : await response.json() as JsonResponse;
    if (response.status !== expectedStatus) {
      throw new Error(`${path} returned ${response.status}, expected ${expectedStatus}: ${JSON.stringify(body)}`);
    }
    return { body, response };
  };

  const post = (path: string, body: unknown, expectedStatus: number, extraHeaders: HeadersInit = {}) => (
    request(path, {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        origin: environment.APP_ORIGIN,
        ...extraHeaders,
      },
      method: "POST",
    }, expectedStatus)
  );

  const clearVerifiedLock = async (): Promise<void> => {
    const client = new Client({ connectionString: environment.DATABASE_URL });
    await client.connect();
    try {
      const locked = await client.query<{ protected: boolean }>(
        `SELECT failed_login_count >= 5 AND locked_until > clock_timestamp() AS protected
         FROM app.users WHERE email = $1`,
        [email],
      );
      if (!locked.rows[0]?.protected) throw new Error("Database account lock was not activated");
      await client.query(
        `UPDATE app.users
         SET failed_login_count = 0, locked_until = NULL, last_failed_login_at = NULL
         WHERE email = $1`,
        [email],
      );
    } finally {
      await client.end();
    }
  };

  let smokeError: unknown;
  try {
    await request("/auth/session", { method: "GET" }, 401);
    await request("/auth/register", {
      body: JSON.stringify({
        displayName: "Smoke Test",
        email,
        password: originalPassword,
        personalDataConsent: true,
        personalDataConsentVersion: REGISTRATION_PERSONAL_DATA_CONSENT_VERSION,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }, 403);

    await post("/auth/register", {
      displayName: "Smoke Test",
      email,
      password: originalPassword,
    }, 400);

    const registration = await post("/auth/register", {
      displayName: "Smoke Test",
      email,
      password: originalPassword,
      personalDataConsent: true,
      personalDataConsentVersion: REGISTRATION_PERSONAL_DATA_CONSENT_VERSION,
    }, 202);
    const verificationToken = String(registration.body.developmentToken ?? "");
    if (!verificationToken) throw new Error("Development verification token is missing");
    const verification = await post("/auth/email/verify", { token: verificationToken, password: originalPassword }, 201);
    createdUserId = String(verification.body.userId ?? "");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await post("/auth/login", { email, password: "wrong-password-value" }, 401);
    }
    await post("/auth/login", { email, password: originalPassword }, 401);
    await clearVerifiedLock();
    const login = await post("/auth/login", { email, password: originalPassword }, 201);
    const firstCsrf = String(login.body.csrfToken ?? "");
    if (!firstCsrf || login.body.role !== "customer") throw new Error("Customer login contract is invalid");

    await request("/auth/session", { method: "GET" }, 200);
    await post("/auth/logout", {}, 400);

    const forgot = await post("/auth/password/forgot", { email }, 202);
    const resetToken = String(forgot.body.developmentToken ?? "");
    if (!resetToken) throw new Error("Development reset token is missing");
    await post("/auth/password/reset", {
      password: replacementPassword,
      token: resetToken,
    }, 201);
    await request("/auth/session", { method: "GET" }, 401);

    cookies.clear();
    const secondLogin = await post("/auth/login", { email, password: replacementPassword }, 201);
    const secondCsrf = String(secondLogin.body.csrfToken ?? "");
    await post("/auth/logout", {}, 204, { "x-csrf-token": secondCsrf });
    await request("/auth/session", { method: "GET" }, 401);

  } catch (error) {
    smokeError = error;
  }

  let cleanupError: unknown;
  {
    const client = new Client({ connectionString: environment.DATABASE_URL });
    await client.connect();
    try {
      await client.query("BEGIN");
      const cleanupUser = createdUserId ?? (await client.query<{ id: string }>(
        "SELECT id FROM app.users WHERE email = $1",
        [email],
      )).rows[0]?.id;
      if (cleanupUser) {
        await client.query(
          "DELETE FROM app.outbox_events WHERE aggregate_type = 'auth' AND aggregate_id = $1",
          [cleanupUser],
        );
        await client.query("DELETE FROM app.auth_sessions WHERE user_id = $1", [cleanupUser]);
        await client.query("DELETE FROM app.email_verification_tokens WHERE user_id = $1", [cleanupUser]);
        await client.query("DELETE FROM app.password_reset_tokens WHERE user_id = $1", [cleanupUser]);
        await client.query(
          `
            UPDATE app.users
            SET email = 'deleted+' || id::text || '@example.invalid',
                display_name = 'Removed auth smoke account',
                password_hash = NULL,
                status = 'disabled',
                session_invalid_before = clock_timestamp(),
                deleted_at = clock_timestamp()
            WHERE id = $1
          `,
          [cleanupUser],
        );
      }
      await client.query("DELETE FROM app.auth_attempts WHERE email = $1", [email]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      cleanupError = error;
    } finally {
      await client.end();
    }
  }

  if (smokeError) throw smokeError;
  if (cleanupError) throw cleanupError;
  process.stdout.write(JSON.stringify({ event: "auth.smoke.passed", tests: 19 }) + "\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Auth smoke failed"}\n`);
  process.exitCode = 1;
});
