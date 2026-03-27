import path from "path";
import type { NextConfig } from "next";

const repoRoot = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: repoRoot,
  serverExternalPackages: ["better-sqlite3", "@napi-rs/canvas"],
};

export default nextConfig;
