import { describe, expect, it } from "vitest";

import { assertDevelopmentSeedAllowed } from "./seed-guard.js";

describe("development seed gate", () => {
  it("accepts only an explicitly marked development database", () => {
    expect(() => assertDevelopmentSeedAllowed({
      ALLOW_DEV_SEED: "true",
      DATABASE_ENVIRONMENT: "development",
      NODE_ENV: "development",
    })).not.toThrow();
  });

  it("rejects production even if the opt-in flag is set", () => {
    expect(() => assertDevelopmentSeedAllowed({
      ALLOW_DEV_SEED: "true",
      DATABASE_ENVIRONMENT: "production",
      NODE_ENV: "production",
    })).toThrow(/Development seed is blocked/);
  });
});
