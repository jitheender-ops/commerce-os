import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Each file gets its own database file, so they must not share a process.
    pool: "forks",
    fileParallelism: false,
    setupFiles: ["tests/setup.ts"],
  },
});
