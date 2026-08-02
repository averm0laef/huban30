import { describe, expect, it } from "vitest";

import { isPubliclyCacheableApiRequest } from "./http-cache-policy.js";

describe("API cache policy", () => {
  it("allows only anonymous publication GET routes to opt into caching", () => {
    expect(isPubliclyCacheableApiRequest("GET", "/api/v1/catalog/products?q=filter")).toBe(true);
    expect(isPubliclyCacheableApiRequest("GET", "/api/v1/public/content/privacy")).toBe(true);
    expect(isPubliclyCacheableApiRequest("GET", "/api/v1/account")).toBe(false);
    expect(isPubliclyCacheableApiRequest("GET", "/api/v1/orders/guest/id")).toBe(false);
    expect(isPubliclyCacheableApiRequest("GET", "/api/v1/staff/contact-requests/id")).toBe(false);
    expect(isPubliclyCacheableApiRequest("POST", "/api/v1/contact-requests")).toBe(false);
  });
});
