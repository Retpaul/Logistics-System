import { defineConfig } from "vitest/config";
// No application setup, environment loading, migrations, network or database fixtures.
export default defineConfig({
  test: { include: ["test/mongo-models.test.ts"] },
});
