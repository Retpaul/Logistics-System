import { defineConfig } from "vitest/config";
// No app/database setup. Target and source rows are in-memory fixtures.
export default defineConfig({
  test: { include: ["test/portfolio-import.test.ts"] },
});
