import path from "node:path";

import type { NextConfig } from "next";

const workspaceRoot = path.resolve(import.meta.dirname, "../..");
const internalApiUrl = process.env.INTERNAL_API_URL ?? "http://127.0.0.1:4000";
// Only the production deployment may be indexed; staging answers noindex for
// every path so a closed environment cannot leak into search results.
const indexingAllowed = process.env.DEPLOYMENT_ENVIRONMENT === "production";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    // The only SVG served through next/image is the trusted local brand
    // mark (apps/web/public/brand/logo.svg), never user- or CMS-supplied
    // input, so allowing SVG optimisation here cannot become an XSS vector.
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  output: "standalone",
  outputFileTracingRoot: workspaceRoot,
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      ...(indexingAllowed
        ? []
        : [{
            headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
            source: "/:path*",
          }]),
      {
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
        source: "/auth",
      },
      {
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
        source: "/:privatePath(profile|checkout|chat|admin)/:path*",
      },
    ];
  },
  async rewrites() {
    return [
      { destination: `${internalApiUrl}/api/v1/:path*`, source: "/api/v1/:path*" },
      { destination: `${internalApiUrl}/ws`, source: "/ws" },
    ];
  },
  turbopack: {
    root: workspaceRoot,
  },
};

export default nextConfig;
