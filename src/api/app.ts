import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "../env";
import { apiKeyAuth } from "./middleware/auth";
import { healthRoute } from "./routes/health";
import { typesRoute } from "./routes/types";
import { emailsRoute } from "./routes/emails";

export const app = new Hono<{ Bindings: Env }>();

// Global middleware
app.use("/api/*", cors());

// Health endpoint (no auth required)
app.route("/api/health", healthRoute);

// Protected routes
app.use("/api/emails/*", apiKeyAuth());
app.use("/api/types/*", apiKeyAuth());
// Also protect exact paths without trailing content
app.use("/api/emails", apiKeyAuth());
app.use("/api/types", apiKeyAuth());

app.route("/api/emails", emailsRoute);
app.route("/api/types", typesRoute);

// 404 fallback
app.notFound((c) => c.json({ error: "Not found" }, 404));

// Global error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});
