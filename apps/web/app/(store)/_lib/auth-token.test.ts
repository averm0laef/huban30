import { describe, expect, it } from "vitest";

import { consumeAuthToken } from "./auth-token";

describe("consumeAuthToken", () => {
  it("reads a fragment token without leaving it in the clean URL", () => {
    expect(consumeAuthToken("https://an30.ru/auth?mode=reset#token=one-time-secret")).toEqual({
      cleanUrl: "/auth?mode=reset",
      token: "one-time-secret",
    });
  });

  it("supports and removes a legacy query token", () => {
    expect(consumeAuthToken("https://an30.ru/auth?mode=verify&token=legacy-secret")).toEqual({
      cleanUrl: "/auth?mode=verify",
      token: "legacy-secret",
    });
  });

  it("preserves unrelated query and fragment values", () => {
    expect(consumeAuthToken("https://an30.ru/auth?mode=staff-accept#token=secret&source=email")).toEqual({
      cleanUrl: "/auth?mode=staff-accept#source=email",
      token: "secret",
    });
  });
});
