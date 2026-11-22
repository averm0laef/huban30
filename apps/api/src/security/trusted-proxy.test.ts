import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { trustedProxyRanges } from "./trusted-proxy.js";

describe("trusted proxy addresses", () => {
  it("ignores forwarded identity from a direct untrusted client", async () => {
    const app = Fastify({ trustProxy: trustedProxyRanges({ TRUST_PROXY_CIDRS: "192.0.2.10/32" }) });
    app.get("/", (request) => ({ ip: request.ip, host: request.host, protocol: request.protocol }));
    try {
      const response = await app.inject({ url: "/", remoteAddress: "203.0.113.9", headers: {
        host: "shop.example", "x-forwarded-for": "192.0.2.44", "x-forwarded-host": "forged.example", "x-forwarded-proto": "https",
      } });
      expect(response.json()).toEqual({ ip: "203.0.113.9", host: "shop.example", protocol: "http" });
    } finally { await app.close(); }
  });

  it("accepts forwarded identity only through a trusted proxy", async () => {
    const app = Fastify({ trustProxy: trustedProxyRanges({ TRUST_PROXY_CIDRS: "192.0.2.10/32" }) });
    app.get("/", (request) => ({ ip: request.ip, protocol: request.protocol }));
    try {
      const response = await app.inject({ url: "/", remoteAddress: "192.0.2.10", headers: {
        "x-forwarded-for": "203.0.113.9", "x-forwarded-proto": "https",
      } });
      expect(response.json()).toEqual({ ip: "203.0.113.9", protocol: "https" });
    } finally { await app.close(); }
  });

  it("disables proxy trust by default and rejects hop counts or malformed ranges", () => {
    expect(trustedProxyRanges({})).toBe(false);
    expect(trustedProxyRanges({ TRUST_PROXY_HOPS: "0" })).toBe(false);
    expect(() => trustedProxyRanges({ TRUST_PROXY_HOPS: "1" })).toThrow("TRUST_PROXY_HOPS");
    for (const value of ["true", "0.0.0.0/33", "::1/129", "127.0.0.1/-1", "127.0.0.1/", "127.0.0.1/32/1"]) {
      expect(() => trustedProxyRanges({ TRUST_PROXY_CIDRS: value })).toThrow("TRUST_PROXY_CIDRS");
    }
    expect(trustedProxyRanges({ TRUST_PROXY_CIDRS: "127.0.0.1/32, ::1/128" })).toEqual(["127.0.0.1/32", "::1/128"]);
  });
});
