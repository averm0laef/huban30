import { describe, expect, it } from "vitest";

import { PasswordService } from "./password.service.js";

describe("PasswordService", () => {
  it("hashes with Argon2id and verifies without storing the password", async () => {
    const service = new PasswordService();
    const encoded = await service.hash("correct horse battery staple");

    expect(encoded).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$/u);
    expect(encoded).not.toContain("correct horse");
    await expect(service.verify("correct horse battery staple", encoded)).resolves.toBe(true);
    await expect(service.verify("incorrect horse battery staple", encoded)).resolves.toBe(false);
  });

  it("performs a dummy derivation for an unknown account", async () => {
    await expect(new PasswordService().verify("unknown password", null)).resolves.toBe(false);
  });
});
