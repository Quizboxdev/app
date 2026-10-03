import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// In-memory PostgreSQL fixtures take longer to build when suites run in parallel.
export default defineConfig({ test: { hookTimeout: 120_000 }, resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } } });
