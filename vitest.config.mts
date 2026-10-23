import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// In-memory PostgreSQL fixtures take longer to build when suites run in parallel, and tests that scan the source tree
// or run Python tooling can pass the 5 s default under load (they pass alone).
// JSX is compiled with the automatic runtime so a test can render a component to static markup (tsconfig keeps "preserve" for Next.js).
export default defineConfig({ oxc: { jsx: { runtime: "automatic" } }, test: { hookTimeout: 120_000, testTimeout: 30_000 }, resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } } });
