import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone with only the files the server actually needs, so the
  // container image carries a pruned node_modules instead of the whole tree.
  output: "standalone",
};

export default nextConfig;
