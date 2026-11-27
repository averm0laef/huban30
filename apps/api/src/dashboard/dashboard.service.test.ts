import { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";

import { validateEnvironment } from "../config.js";
import type { DatabaseService } from "../infrastructure/database.service.js";
import { StaffDashboardService } from "./dashboard.service.js";

const secrets = {
  DATA_ENCRYPTION_KEY: "test-data-encryption-key-with-more-than-32-characters",
  SESSION_SECRET: "test-session-hmac-secret-with-more-than-32-characters",
};

describe("staff dashboard Rossko connection", () => {
  it.each([
    { enabled: "true", state: "ok", detail: "Подключён", hint: null },
    { enabled: "false", state: "off", detail: "Ключи не заполнены", hint: "secrets/rossko_key1.txt и rossko_key2.txt" },
  ])("reports $enabled from the validated application environment", async ({ enabled, state, detail, hint }) => {
    const config = new ConfigService(validateEnvironment({
      ...secrets,
      ROSSKO_ENABLED: enabled,
      ROSSKO_KEY1: "test-key-one",
      ROSSKO_KEY2: "test-key-two",
    }));
    const database = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const dashboard = new StaffDashboardService(database as unknown as DatabaseService, config);

    const result = await dashboard.dashboard("today");

    expect(result.services.find((service) => service.key === "rossko")).toEqual({
      key: "rossko", name: "Rossko API", state, detail, hint,
    });
  });
});
