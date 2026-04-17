import * as Sentry from "@sentry/cloudflare";
import { app } from "./api/app";
import { handleEmail } from "./handlers/email";
import { handleQueue } from "./handlers/queue";
import type { Env } from "./env";
import type { EmailProcessedEvent } from "./services/queue";

export default Sentry.withSentry(
  (env: Env) => ({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 1.0,
  }),
  {
    fetch: app.fetch,

    async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
      Sentry.addBreadcrumb({ message: "Email received", data: { from: message.from, to: message.to } });
      try {
        await handleEmail(message, env);
      } catch (err) {
        Sentry.captureException(err, {
          tags: { handler: "email" },
          extra: { from: message.from, to: message.to },
        });
        throw err;
      }
    },

    async queue(batch: MessageBatch<EmailProcessedEvent>, env: Env, ctx: ExecutionContext) {
      Sentry.addBreadcrumb({ message: "Queue batch received", data: { count: batch.messages.length } });
      try {
        await handleQueue(batch, env);
      } catch (err) {
        Sentry.captureException(err, { tags: { handler: "queue" } });
        throw err;
      }
    },
  } as ExportedHandler<Env>
);
