import path from "node:path";
import { defineConfig } from "vitest/config";

// Node-environment unit tests over the pure parts of the Academy and the practice drill flow.
//
// There is no DOM here on purpose. The rules worth protecting — unlock order, progress
// aggregation, certificate eligibility, check scoring, the coaching phase machine, and the
// separation between Practice and Ranked — are all pure functions, and they were written as pure
// functions so they could be tested without rendering anything.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
