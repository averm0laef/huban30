import path from "node:path";

import type { NextConfig } from "next";

const workspaceRoot = path.resolve(import.meta.dirname, "../..");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  outputFileTracingRoot: workspaceRoot,
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: {
    root: workspaceRoot,
  },
};

export default nextConfig;
