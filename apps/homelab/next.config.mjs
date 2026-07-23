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
  typedRoutes: true,
  transpilePackages: ["@iw/core", "@iw/ui", "@iw/lab-runtime"],
  outputFileTracingRoot: repoRoot,
};

export default nextConfig;
