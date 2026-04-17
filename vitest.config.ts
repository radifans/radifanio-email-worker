import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

const migrations = await readD1Migrations("./drizzle");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          API_KEY: "test-api-key-12345",
          SENTRY_DSN: "",
          TEST_MIGRATIONS: JSON.stringify(migrations),
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/setup/apply-d1-migrations.ts"],
    include: ["test/unit/**/*.test.ts", "test/integration/**/*.test.ts"],
  },
});
