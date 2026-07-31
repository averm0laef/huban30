import { describe, expect, it } from "vitest";

import { getDatabaseConfig } from "./config.js";

describe("database configuration", () => {
  it("fails closed when neither a URL nor a password is configured", () => {
    expect(() => getDatabaseConfig({})).toThrow(/Database credentials are required/);
  });

  it("defaults the database marker to production", () => {
    const config = getDatabaseConfig({ DATABASE_URL: "postgresql://an30:secret@db:5432/an30" });

    expect(config.databaseEnvironment).toBe("production");
    expect(config.ssl).toBe(false);
  });

  it("builds an encoded connection URL from explicit fields", () => {
    const config = getDatabaseConfig({
      DATABASE_ENVIRONMENT: "staging",
      DATABASE_SSL: "true",
      DB_HOST: "postgres.internal",
      DB_NAME: "an30_stage",
      DB_PORT: "5544",
      DB_USER: "an30 app",
      POSTGRES_PASSWORD: "p@ss/word",
    });

    expect(config.connectionString).toBe(
      "postgresql://an30%20app:p%40ss%2Fword@postgres.internal:5544/an30_stage",
    );
    expect(config.databaseEnvironment).toBe("staging");
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
  });
});
