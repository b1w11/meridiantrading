import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    // Exclude Claude Code worktrees from file scanning — they contain their
    // own node_modules and lockfiles which cause Turbopack to index the
    // entire parent tree (leading to huge memory/startup overhead).
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
