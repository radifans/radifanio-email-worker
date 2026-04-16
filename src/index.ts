import { Hono } from "hono";
import type { Env } from "./env";
import { apiKeyAuth } from "./api/middleware/auth";
import { healthRoute } from "./api/routes/health";
import { typesRoute } from "./api/routes/types";
import { emailsRoute } from "./api/routes/emails";
import { handleEmail } from "./handlers/email";
import { handleQueue } from "./handlers/queue";

const app = new Hono<{ Bindings: Env }>();

app.route("/api/health", healthRoute);
app.use("/api/*", apiKeyAuth());
app.route("/api/types", typesRoute);
app.route("/api/emails", emailsRoute);

export default {
  fetch: app.fetch,
  email: handleEmail,
  queue: handleQueue,
};
