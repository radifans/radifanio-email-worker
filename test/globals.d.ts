/// <reference path="../node_modules/@cloudflare/vitest-pool-workers/types/cloudflare-test.d.ts" />

// Declare our Worker bindings on Cloudflare.Env so `env` from cloudflare:test is typed correctly
declare namespace Cloudflare {
  interface Env {
    EMAIL_STORAGE: R2Bucket;
    EMAIL_DB: D1Database;
    EMAIL_QUEUE: Queue<unknown>;
    API_KEY: string;
    SENTRY_DSN: string;
    TEST_MIGRATIONS: string;
  }
}

// Broaden Response.json() to return `any` so test assertions don't need explicit casting
interface Response {
  json(): Promise<any>;
}
