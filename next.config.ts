import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone with only the files the server actually needs, so the
  // container image carries a pruned node_modules instead of the whole tree.
  output: "standalone",

  // File tracing otherwise sweeps the live demo database into the bundle — 1.3 MB
  // of somebody's rehearsal, approvals and audit rows included. The Docker build
  // never sees it (`.dockerignore` excludes `data`), but a build run anywhere else
  // would ship stale state and break the guarantee that a fresh boot seeds itself
  // to the identical dataset.
  outputFileTracingExcludes: { "*": ["data/**"] },
};

export default nextConfig;
