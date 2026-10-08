import type { NextConfig } from "next";
import { validatePublicEnvironment } from "./lib/env";

// The Vercel-Supabase integration may provide the public key as NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; every call site reads
// NEXT_PUBLIC_SUPABASE_ANON_KEY, so it is normalised here and inlined into client and server bundles through `env` below.
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (publicKey) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = publicKey;

// Fail the build (not the visitor's sign-in) when the public Supabase URL and key are missing or do not belong together.
// On Vercel the check is unconditional: a build without the key used to deploy and break every sign-in and dynamic page.
if (process.env.VERCEL || (process.env.NEXT_PUBLIC_SUPABASE_URL && publicKey)) {
  validatePublicEnvironment({ NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: publicKey });
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  // pdf-parse v2 ships pdfjs-dist, which fails when webpack bundles it into server routes.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  ...(publicKey ? { env: { NEXT_PUBLIC_SUPABASE_ANON_KEY: publicKey } } : {}),
};

export default nextConfig;
