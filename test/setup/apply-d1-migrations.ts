import { env } from "cloudflare:test";
import { applyD1Migrations } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";

const migrations: D1Migration[] = JSON.parse(
  (env as unknown as { TEST_MIGRATIONS: string }).TEST_MIGRATIONS
);
await applyD1Migrations(env.EMAIL_DB, migrations);
