import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // @iw/* ship as TypeScript source (monorepo workspaces) — let Next compile them
  transpilePackages: ["@iw/core", "@iw/ui"],
  // trace files from the repo root so the standalone bundle includes the workspace package
  outputFileTracingRoot: repoRoot,
};

export default nextConfig;
