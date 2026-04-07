import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root so Next.js doesn't get confused by stray
  // lockfiles in parent directories.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
