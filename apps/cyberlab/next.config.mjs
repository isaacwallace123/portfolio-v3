import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // self-contained server bundle for the Docker image
  output: "standalone",
  // The public site is content + read-only replays; the live/admin routes need the server runtime
  // (they broker sanitized data and, later, scoped read-only Guacamole tokens), so this is NOT a
  // static export. Deploy as a Node server behind a private tunnel to the lab. See README.
  typedRoutes: true,
  // @iw/* ship as TypeScript source (monorepo workspaces) — let Next compile them
  transpilePackages: ["@iw/core", "@iw/ui"],
  // trace files from the repo root so the standalone bundle includes the workspace package
  outputFileTracingRoot: repoRoot,
};

export default nextConfig;
