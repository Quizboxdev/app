import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  // pdf-parse v2 ships pdfjs-dist, which fails when webpack bundles it into server routes.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
