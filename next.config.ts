import type { NextConfig } from "next";
import { validatePublicEnvironment } from "./lib/env";

// Fail the build (not the visitor's sign-in) when the public Supabase URL and key do not belong together.
if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) validatePublicEnvironment({ NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  // pdf-parse v2 ships pdfjs-dist, which fails when webpack bundles it into server routes.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
