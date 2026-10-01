import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Use Next's TypeScript API path during builds. This keeps production checks
  // deterministic in runners where child-process stdout is unavailable.
  experimental: {
    useTypeScriptCli: false,
  },
};

export default nextConfig;
