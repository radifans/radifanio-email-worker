export interface Env {
  EMAIL_STORAGE: R2Bucket;
  EMAIL_DB: D1Database;
  EMAIL_QUEUE: Queue<unknown>;
  API_KEY: string;
  SENTRY_DSN: string;
}
