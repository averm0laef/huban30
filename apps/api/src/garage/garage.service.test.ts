import { describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/auth-context.js";
import type { DatabaseService } from "../infrastructure/database.service.js";
import { GarageService } from "./garage.service.js";

const USER_ID = "019bf9ea-0d3e-7def-8c9a-000000000001";
const VEHICLE_ID = "019bf9ea-0d3e-7def-8c9a-000000000009";
const auth: AuthContext = {
  csrfTokenHash: Buffer.alloc(32),
  email: "user@example.test",
  mfaSetupRequired: false,
  mfaVerified: true,
  role: "customer",
  sessionId: "019bf9ea-0d3e-7def-8c9a-000000000002",
  userId: USER_ID,
};
const saved = {
  catalog_model_id: null, catalog_modification_id: null, created_at: new Date("2026-11-22T00:00:00Z"),
  details: "2.5 AT", id: VEHICLE_ID, is_primary: true, source: "manual",
  tecdoc_gen_id: null, tecdoc_mfa_id: null, tecdoc_ms_id: null, title: "Toyota Camry 2018",
};

function garage(clientQuery: ReturnType<typeof vi.fn>) {
  return new GarageService({
    transaction: vi.fn(async (work: (client: { query: typeof clientQuery }) => Promise<unknown>) => (
      work({ query: clientQuery })
    )),
  } as unknown as DatabaseService);
}

describe("GarageService.add for a repeated submission", () => {
  it("answers with the car already in the garage instead of a second copy", async () => {
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [saved] });

    await expect(garage(clientQuery).add({ details: "2.5 AT", title: "Toyota Camry 2018" }, auth))
      .resolves.toMatchObject({ id: VEHICLE_ID, isPrimary: true });

    // Copies of one click queue on the customer's lock, then find the car the first one saved.
    expect(clientQuery.mock.calls[0]?.[0]).toContain("pg_advisory_xact_lock");
    expect(clientQuery.mock.calls[1]?.[1]).toEqual([
      USER_ID, "Toyota Camry 2018", "2.5 AT", "manual", null, null, null, null, null,
    ]);
    expect(clientQuery).toHaveBeenCalledTimes(2);
  });

  it("makes the saved car the main one when it is sent again as the main one", async () => {
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...saved, is_primary: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [saved] });

    await expect(garage(clientQuery).add({ details: "2.5 AT", primary: true, title: "Toyota Camry 2018" }, auth))
      .resolves.toMatchObject({ id: VEHICLE_ID, isPrimary: true });

    expect(clientQuery.mock.calls[3]?.[1]).toEqual([VEHICLE_ID, USER_ID]);
    expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO"))).toBe(false);
  });

  it("still adds a different car", async () => {
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: "1", has_primary: true }] })
      .mockResolvedValueOnce({ rows: [{ ...saved, id: "019bf9ea-0d3e-7def-8c9a-00000000000a", is_primary: false, title: "Lada Vesta" }] });

    await expect(garage(clientQuery).add({ title: "Lada Vesta" }, auth))
      .resolves.toMatchObject({ isPrimary: false, title: "Lada Vesta" });
    expect(String(clientQuery.mock.calls[3]?.[0])).toContain("INSERT INTO app.customer_vehicles");
  });
});
