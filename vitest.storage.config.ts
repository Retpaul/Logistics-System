import { defineConfig } from "vitest/config";

// Pure unit tests: deliberately no database setup or migration hooks.
export default defineConfig({ test: { include: ["test/storage.test.ts"] } });
