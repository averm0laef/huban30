import path from "node:path";

import type { NextConfig } from "next";

const workspaceRoot = path.resolve(import.meta.dirname, "../..");
const internalApiUrl = process.env.INTERNAL_API_URL ?? "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  outputFileTracingRoot: workspaceRoot,
  poweredByHeader: false,
  reactStrictMode: true,
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
