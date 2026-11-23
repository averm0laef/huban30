import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Api = typeof import("./storefront-api");
let api: Api;

function answer(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" }, status });
}

describe("one answer about the visitor's session per page", () => {
  beforeEach(async () => { vi.resetModules(); api = await import("./storefront-api"); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("asks once for the whole page, a guest included", async () => {
    const fetch = vi.fn(async () => answer(401, { error: "Unauthorized" }));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("document", { cookie: "" });
    const answers = await Promise.all([api.readSession(), api.readSession(), api.readSession()]);
    expect(answers).toEqual([null, null, null]);
    expect(await api.readSession()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("asks again after a sign-in or any other change", async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => (init?.method === "POST"
      ? answer(200, { ok: true })
      : answer(200, { email: "a@b.c", mfaSetupRequired: false, mfaVerified: true, role: "customer", userId: "u1" })));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("document", { cookie: "" });
    await api.readSession();
    await api.apiRequest("/auth/login", { body: {}, method: "POST" });
    await api.readSession();
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/auth/session"))).toHaveLength(2);
  });
});
