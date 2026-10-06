import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't let `next dev` regenerate AGENTS.md and CLAUDE.md.
  agentRules: false,
};

export default nextConfig;
