import { describe, expect, it } from "vitest";

import { sanitizeLogValue } from "./structured-logger.js";

describe("structured log redaction", () => {
  it("redacts credentials and PII before serialization", () => {
    expect(sanitizeLogValue({
      email: "customer@example.com",
      nested: {
        ipAddress: "192.0.2.25",
        message: "Login customer@example.com from 192.0.2.25",
        sessionToken: "opaque-value",
      },
    })).toEqual({
      email: "[redacted]",
      nested: {
        ipAddress: "[redacted]",
        message: "Login [email-redacted] from [ip-redacted]",
        sessionToken: "[redacted]",
      },
    });
  });
});
