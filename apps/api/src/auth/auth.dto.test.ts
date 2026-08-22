import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";

import { REGISTRATION_PERSONAL_DATA_CONSENT_VERSION } from "@an30/contracts";

import { RegisterDto } from "./auth.dto.js";

const validRegistration = {
  displayName: "Антон Ермолаев",
  email: " Client@Example.COM ",
  password: "long password phrase",
  personalDataConsent: true,
  personalDataConsentVersion: REGISTRATION_PERSONAL_DATA_CONSENT_VERSION,
};

async function registrationErrors(input: Record<string, unknown>) {
  return validate(plainToInstance(RegisterDto, input));
}

describe("registration consent validation", () => {
  it("accepts an explicit consent with the current document version", async () => {
    const registration = plainToInstance(RegisterDto, validRegistration);

    await expect(validate(registration)).resolves.toEqual([]);
    expect(registration.email).toBe("client@example.com");
  });

  it("rejects missing, false and stale consent values", async () => {
    const missing = { ...validRegistration };
    delete (missing as Partial<typeof validRegistration>).personalDataConsent;

    await expect(registrationErrors(missing)).resolves.not.toEqual([]);
    await expect(registrationErrors({ ...validRegistration, personalDataConsent: false }))
      .resolves.not.toEqual([]);
    await expect(registrationErrors({
      ...validRegistration,
      personalDataConsentVersion: "registration-personal-data-old",
    })).resolves.not.toEqual([]);
  });
});
