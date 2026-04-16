import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: {
            API_KEY: "test-api-key-12345",
            SENTRY_DSN: "",
          },
        },
      },
    },
  },
});
