// Sign-up, confirmation, sign-in, sign-out and password recovery in a real browser against the local stand, then the
// same doors pushed the wrong way through the API. Nothing is mocked. The stand mails nothing, so each letter is
// taken from the queue the way the worker takes it (auth-letter.mjs) and its link is followed; the letters are also
// written to AN30_AUTH_LETTERS_DIR (default /tmp) as letter-verify.html and letter-reset.html, to be looked at.
//   corepack pnpm --filter @an30/worker build
//   sh scripts/storefront-checks/auth-reset-limits.sh     # the check itself exhausts the sign-in limits of its address
//   node scripts/storefront-checks/auth-flow.mjs
// The site is opened by the stand's own origin (APP_ORIGIN): the API refuses a POST from any other.
import { chromium } from "../../node_modules/@playwright/test/index.mjs";
import { letterFor, stand } from "./auth-letter.mjs";

const base = process.argv[2] ?? stand.APP_ORIGIN;
const SHOTS = process.env.AN30_AUTH_LETTERS_DIR ?? "/tmp";
const stamp = Date.now().toString(36);
const email = `auth-check-${stamp}@an30-check.test`;
const firstPassword = `First local password ${stamp}`;
const secondPassword = `Second local password ${stamp}`;
let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed += 1; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { height: 900, width: 1440 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error.message).split("\n")[0]));
page.on("response", (response) => { if (response.status() >= 500) errors.push(`${response.status()} ${response.url().slice(0, 90)}`); });
const banner = async () => ((await page.locator("[role='alert'], [role='status']").allTextContents()).join(" | ")).replace(/\s+/gu, " ").trim().slice(0, 160);

// 1. Sign-up.
await page.goto(`${base}/auth?mode=register`, { waitUntil: "load" });
await page.getByLabel("Имя", { exact: true }).fill("Проверка Входа");
await page.getByLabel("Email", { exact: true }).fill(email);
await page.locator('input[name="password"]').fill(firstPassword);
await page.locator('input[name="personalDataConsent"]').check();
if (await page.locator('input[name="termsAccepted"]').count()) await page.locator('input[name="termsAccepted"]').check();
await page.getByRole("button", { name: "Создать аккаунт", exact: true }).click();
await page.getByText("Проверьте почту").first().waitFor({ timeout: 20000 }).catch(() => undefined);
check("sign-up: the form is accepted and a letter is announced", await page.getByText("Проверьте почту").count() >= 1, await banner());
// The stand mails nothing: the letter is taken from the queue the way the worker takes it, and built by its template.
const welcome = await letterFor(email, "auth.email.verify", `${SHOTS}/letter-verify`);
check("the letter of confirmation is queued, with its link in the text and in the HTML", Boolean(welcome?.link) && welcome.htmlHasLink && welcome.subject === "Подтверждение email АН-30", welcome ? `«${welcome.subject}», ${welcome.textLength} characters of text` : "no letter in the queue");

// 2. Confirmation of the address by the link of the letter.
await page.goto(welcome.link, { waitUntil: "load" });
await page.locator('input[name="password"]').fill(firstPassword);
await page.getByRole("button", { name: "Подтвердить email", exact: true }).click();
await page.getByText("Email подтверждён", { exact: true }).first().waitFor({ timeout: 20000 }).catch(() => undefined);
check("confirmation: the address is confirmed and the token leaves the address bar", await page.getByText("Email подтверждён", { exact: true }).count() >= 1 && new URL(page.url()).hash === "", `${await banner()} | ${page.url().slice(0, 80)}`);

// 3. Sign-in.
const signIn = async (password) => {
  await page.goto(`${base}/auth?mode=login`, { waitUntil: "load" });
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/profile"), { timeout: 15000 }).catch(() => undefined);
  return new URL(page.url()).pathname;
};
check("sign-in: opens the personal account", (await signIn(firstPassword)).startsWith("/profile"), page.url().slice(0, 80));
const cookies = await context.cookies();
const session = cookies.find((cookie) => /session/u.test(cookie.name));
check("the session cookie cannot be read by scripts and is not sent across sites", Boolean(session?.httpOnly) && ["Lax", "Strict"].includes(session?.sameSite ?? ""), session ? `${session.name}: httpOnly ${session.httpOnly}, sameSite ${session.sameSite}` : "no session cookie");

// 4. Sign-out.
const out = page.getByRole("button", { name: "Выйти из аккаунта", exact: true });
await out.waitFor({ timeout: 20000 }).catch(() => undefined);
check("the personal account shows the customer and offers to sign out", await out.count() === 1 && await page.getByText(email).count() >= 1);
await out.click();
await page.waitForURL((url) => url.pathname === "/auth", { timeout: 15000 }).catch(() => undefined);
await page.goto(`${base}/profile`, { waitUntil: "load" });
await page.getByText("Войдите в личный кабинет").first().waitFor({ timeout: 15000 }).catch(() => undefined);
check("sign-out: the personal account is closed again", await page.getByText("Войдите в личный кабинет").count() >= 1 && await page.getByText(email).count() === 0, page.url().slice(0, 80));
const after = (await context.cookies()).find((cookie) => /session/u.test(cookie.name));
check("…and the session cookie is gone", !after || after.value === "", after ? `${after.name} still set` : "");

// 5. Password recovery.
await page.goto(`${base}/auth?mode=forgot`, { waitUntil: "load" });
await page.getByLabel("Email", { exact: true }).fill(email);
await page.locator("main form button[type='submit']").last().click();
await page.getByText("Проверьте почту").first().waitFor({ timeout: 20000 }).catch(() => undefined);
const recovery = await letterFor(email, "auth.password.reset", `${SHOTS}/letter-reset`);
check("recovery: a letter with a link is queued", Boolean(recovery?.link) && recovery.htmlHasLink && recovery.subject === "Восстановление пароля АН-30", `${await banner()} | ${recovery ? `«${recovery.subject}»` : "no letter in the queue"}`);
await page.goto(recovery.link, { waitUntil: "load" });
await page.locator('input[name="password"]').fill(secondPassword);
await page.locator('input[name="passwordConfirm"]').fill(secondPassword);
await page.locator("main form button[type='submit']").last().click();
await page.getByText("Пароль изменён", { exact: true }).first().waitFor({ timeout: 20000 }).catch(() => undefined);
check("recovery: the new password is set", await page.getByText("Пароль изменён", { exact: true }).count() >= 1, await banner());

// 6. The old password no longer opens the account; the new one does.
const withOld = await signIn(firstPassword);
check("the old password is refused with a plain message", !withOld.startsWith("/profile") && (await banner()).length > 0, await banner());
check("the new password opens the account", (await signIn(secondPassword)).startsWith("/profile"));
check("no page crashed and the server answered no 5xx on the way", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();

// 7. The same doors pushed the wrong way (the API directly, with the site's own Origin).
const post = async (path, body, headers = {}) => {
  const response = await fetch(`${base}/api/v1${path}`, { body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json", Origin: base, ...headers }, method: "POST" });
  return { status: response.status, text: (await response.text()).slice(0, 200) };
};
const known = await post("/auth/password/forgot", { email });
const unknown = await post("/auth/password/forgot", { email: `nobody-${stamp}@an30-check.test` });
const strip = (text) => text.replace(/,?"developmentToken":"[^"]*",?/u, "");
check("recovery does not tell whether an address is registered", known.status === unknown.status && strip(known.text) === strip(unknown.text), `${known.status} / ${unknown.status}`);
const signUp = (address) => post("/auth/register", { displayName: "Повтор", email: address, password: firstPassword, personalDataConsent: true, personalDataConsentVersion: "registration-personal-data-2026-08-15-v1" });
const taken = await signUp(email);
const fresh = await signUp(`fresh-${stamp}@an30-check.test`);
check("a second sign-up with a taken address answers exactly as a first one: it does not tell the address is taken", taken.status === fresh.status && taken.status < 300 && strip(taken.text) === strip(fresh.text), `${taken.status} / ${fresh.status} ${taken.text.slice(0, 70)}`);
const rubbish = [
  ["an empty body", "{}"], ["not JSON", "{{{"], ["an array", "[1,2,3]"], ["null", "null"],
  ["wrong types", { email: 12345, password: { $ne: "" } }],
  ["a script in the address", { email: "<script>alert(1)</script>@x.test", password: "x".repeat(20) }],
  ["SQL in the address", { email: "' OR 1=1 --@x.test", password: "x".repeat(20) }],
  ["a megabyte of password", { email, password: "я".repeat(600_000) }],
  ["a null byte", { email: `a\u0000b@x.test`, password: "x".repeat(20) }],
  ["extra fields", { email, password: firstPassword, role: "admin", isStaff: true }],
];
for (const pathName of ["/auth/login", "/auth/register", "/auth/password/forgot", "/auth/password/reset", "/auth/email/verify"]) {
  const statuses = [];
  for (const [, body] of rubbish) statuses.push((await post(pathName, body)).status);
  check(`${pathName}: rubbish is refused, never a server error`, statuses.every((status) => status >= 400 && status < 500), statuses.join(" "));
}
const foreign = await post("/auth/login", { email, password: secondPassword }, { Origin: "https://evil.example" });
check("a form on another site cannot sign in for the visitor", foreign.status === 403, String(foreign.status));
const noOrigin = await fetch(`${base}/api/v1/auth/login`, { body: JSON.stringify({ email, password: secondPassword }), headers: { "Content-Type": "application/json" }, method: "POST" });
check("…nor a request without an Origin", noOrigin.status === 403, String(noOrigin.status));
const badToken = await post("/auth/password/reset", { password: secondPassword, token: "0".repeat(43) });
check("a made-up recovery token is refused", badToken.status >= 400 && badToken.status < 500, `${badToken.status} ${badToken.text.slice(0, 80)}`);
const tries = [];
for (let i = 0; i < 12; i += 1) tries.push((await post("/auth/login", { email, password: `wrong ${i} ${stamp}` })).status);
check("guessing a password is cut off: refusals first, then «too many attempts»", tries.includes(429) && tries.every((status) => status === 401 || status === 429 || status === 423), tries.join(" "));
const locked = await post("/auth/login", { email, password: secondPassword });
console.log(`     after the guessing, the right password answers ${locked.status} (${locked.text.slice(0, 70)})`);
console.log(`\n${failed === 0 ? "ALL OK" : `${failed} FAILED`} — account ${email}`);
process.exitCode = failed === 0 ? 0 : 1;
