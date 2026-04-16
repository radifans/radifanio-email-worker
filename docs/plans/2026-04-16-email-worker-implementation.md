# Email Worker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Cloudflare Email Worker that receives forwarded emails, stores content/attachments in R2, saves metadata to D1 via Drizzle ORM, and publishes events to Cloudflare Queues — with a Hono REST API for querying.

**Architecture:** Single Cloudflare Worker with three handlers: `email()` for email ingestion, `fetch()` via Hono for REST API, and `queue()` for downstream event consumption. All state in R2 (object storage) and D1 (SQLite via Drizzle ORM). Sentry for error tracking.

**Tech Stack:** TypeScript, Cloudflare Workers, Hono, Drizzle ORM, postal-mime, Vitest, Wrangler, @sentry/cloudflare

**Design doc:** `docs/plans/2026-04-16-email-worker-design.md`

---

## Project Structure

```
radifanio-email-worker/
├── src/
│   ├── index.ts                        # worker entry point (exports all handlers)
│   ├── env.ts                          # Env type for Worker bindings
│   ├── db/
│   │   └── schema.ts                   # Drizzle ORM table definitions
│   ├── services/
│   │   ├── email-parser.ts             # postal-mime wrapper
│   │   ├── storage.ts                  # R2 upload abstraction
│   │   └── queue.ts                    # CF Queue publishing
│   ├── handlers/
│   │   ├── email.ts                    # email() handler logic
│   │   └── queue.ts                    # queue() consumer logic (stub)
│   ├── api/
│   │   ├── app.ts                      # Hono app with middleware
│   │   ├── middleware/
│   │   │   └── auth.ts                 # API key auth middleware
│   │   └── routes/
│   │       ├── emails.ts               # /api/emails routes
│   │       ├── types.ts                # /api/types routes
│   │       └── health.ts               # /api/health route
│   └── utils/
│       ├── ulid.ts                     # ULID generation
│       └── sanitize.ts                 # filename sanitization
├── test/
│   ├── unit/
│   │   ├── utils/
│   │   │   ├── ulid.test.ts
│   │   │   └── sanitize.test.ts
│   │   ├── services/
│   │   │   └── email-parser.test.ts
│   │   └── api/
│   │       ├── middleware/
│   │       │   └── auth.test.ts
│   │       └── routes/
│   │           ├── types.test.ts
│   │           ├── emails.test.ts
│   │           └── health.test.ts
│   ├── integration/
│   │   └── email-flow.test.ts
│   └── fixtures/
│       └── sample-email.eml
├── drizzle.config.ts
├── wrangler.toml
├── vitest.config.ts
├── tsconfig.json
├── package.json
├── Dockerfile.dev
├── docker-compose.yml
└── .dockerignore
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `wrangler.toml`
- Create: `vitest.config.ts`
- Create: `drizzle.config.ts`
- Create: `src/env.ts`

**Step 1: Initialize package.json and install dependencies**

```bash
cd /Users/mac-200224/Documents/Repositories/personal/radifanio-email-worker

npm init -y

npm install hono drizzle-orm postal-mime ulid @sentry/cloudflare

npm install -D wrangler typescript @cloudflare/workers-types vitest @cloudflare/vitest-pool-workers drizzle-kit
```

**Step 2: Create tsconfig.json**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types/2023-07-01", "@cloudflare/vitest-pool-workers"],
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src",
    "noEmit": true,
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx"
  },
  "include": ["src/**/*", "test/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create wrangler.toml**

Create `wrangler.toml`:

```toml
name = "radifanio-email-worker"
main = "src/index.ts"
compatibility_date = "2024-12-01"
compatibility_flags = ["nodejs_compat"]

# R2 Bucket
[[r2_buckets]]
binding = "EMAIL_STORAGE"
bucket_name = "email-storage"

# D1 Database
[[d1_databases]]
binding = "EMAIL_DB"
database_name = "email-db"
database_id = "placeholder-replace-after-creation"

# Queue Producer
[[queues.producers]]
binding = "EMAIL_QUEUE"
queue = "email-events"

# Queue Consumer (same worker consumes for now)
[[queues.consumers]]
queue = "email-events"
max_batch_size = 10
max_retries = 3

# Email Routing
[triggers]
# Add your custom domain email routes here after deployment
# e.g., routes for *@automation.yourdomain.com
```

**Step 4: Create vitest.config.ts**

Create `vitest.config.ts`:

```typescript
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
```

**Step 5: Create drizzle.config.ts**

Create `drizzle.config.ts`:

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "sqlite",
});
```

**Step 6: Create src/env.ts**

Create `src/env.ts`:

```typescript
export interface Env {
  EMAIL_STORAGE: R2Bucket;
  EMAIL_DB: D1Database;
  EMAIL_QUEUE: Queue<unknown>;
  API_KEY: string;
  SENTRY_DSN: string;
}
```

**Step 7: Add scripts to package.json**

Update `package.json` scripts:

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate:local": "wrangler d1 migrations apply email-db --local",
    "db:migrate:remote": "wrangler d1 migrations apply email-db --remote",
    "typecheck": "tsc --noEmit"
  }
}
```

**Step 8: Commit**

```bash
git add -A
git commit -m "chore: project scaffolding with wrangler, hono, drizzle, vitest"
```

---

## Task 2: Docker Compose Setup

**Files:**
- Create: `Dockerfile.dev`
- Create: `docker-compose.yml`
- Create: `.dockerignore`

**Step 1: Create Dockerfile.dev**

Create `Dockerfile.dev`:

```dockerfile
FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 8787

CMD ["npx", "wrangler", "dev", "--local", "--ip", "0.0.0.0"]
```

**Step 2: Create docker-compose.yml**

Create `docker-compose.yml`:

```yaml
services:
  worker:
    build:
      context: .
      dockerfile: Dockerfile.dev
    ports:
      - "8787:8787"
    volumes:
      - .:/app
      - /app/node_modules
    environment:
      - NODE_ENV=development
```

**Step 3: Create .dockerignore**

Create `.dockerignore`:

```
node_modules
dist
.wrangler
.git
*.md
```

**Step 4: Verify Docker build works**

```bash
docker compose build
```

Expected: Image builds successfully.

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: add Docker Compose for local development"
```

---

## Task 3: Drizzle ORM Schema & Migration

**Files:**
- Create: `src/db/schema.ts`
- Generated: `drizzle/0000_initial.sql` (by drizzle-kit)

**Step 1: Create Drizzle schema**

Create `src/db/schema.ts`:

```typescript
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const emailTypes = sqliteTable("email_types", {
  id: text("id").primaryKey(),
  emailPrefix: text("email_prefix").unique().notNull(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  active: integer("active").default(1).notNull(),
  createdAt: text("created_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
  updatedAt: text("updated_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
});

export const emails = sqliteTable(
  "emails",
  {
    id: text("id").primaryKey(),
    typeId: text("type_id")
      .notNull()
      .references(() => emailTypes.id),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    subject: text("subject"),
    receivedAt: text("received_at").notNull(),
    storagePrefix: text("storage_prefix").notNull(),
    rawSize: integer("raw_size"),
    status: text("status").default("received").notNull(),
    errorMessage: text("error_message"),
    createdAt: text("created_at")
      .default(sql`(datetime('now'))`)
      .notNull(),
  },
  (table) => [
    index("idx_emails_type").on(table.typeId),
    index("idx_emails_received").on(table.receivedAt),
    index("idx_emails_status").on(table.status),
  ]
);

export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    emailId: text("email_id")
      .notNull()
      .references(() => emails.id),
    filename: text("filename").notNull(),
    contentType: text("content_type"),
    size: integer("size"),
    storageKey: text("storage_key").notNull(),
    createdAt: text("created_at")
      .default(sql`(datetime('now'))`)
      .notNull(),
  },
  (table) => [index("idx_attachments_email").on(table.emailId)]
);
```

**Step 2: Generate migration**

```bash
npx drizzle-kit generate
```

Expected: Creates `drizzle/0000_*.sql` with CREATE TABLE statements.

**Step 3: Verify migration SQL looks correct**

```bash
cat drizzle/0000_*.sql
```

Expected: Three CREATE TABLE statements for `email_types`, `emails`, `attachments` with indexes.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add drizzle schema and initial migration"
```

---

## Task 4: ULID Utility

**Files:**
- Create: `src/utils/ulid.ts`
- Create: `test/unit/utils/ulid.test.ts`

**Step 1: Write the failing test**

Create `test/unit/utils/ulid.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { generateUlid } from "../../src/utils/ulid";

describe("generateUlid", () => {
  it("returns a 26-character string", () => {
    const id = generateUlid();
    expect(id).toHaveLength(26);
  });

  it("returns uppercase Crockford base32 characters", () => {
    const id = generateUlid();
    expect(id).toMatch(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateUlid()));
    expect(ids.size).toBe(100);
  });

  it("generates sortable IDs (later calls produce larger values)", async () => {
    const first = generateUlid();
    await new Promise((r) => setTimeout(r, 2));
    const second = generateUlid();
    expect(second > first).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run test/unit/utils/ulid.test.ts
```

Expected: FAIL — module not found.

**Step 3: Write implementation**

Create `src/utils/ulid.ts`:

```typescript
import { ulid } from "ulid";

export function generateUlid(): string {
  return ulid();
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run test/unit/utils/ulid.test.ts
```

Expected: All 4 tests PASS.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add ULID generation utility"
```

---

## Task 5: Filename Sanitization Utility

**Files:**
- Create: `src/utils/sanitize.ts`
- Create: `test/unit/utils/sanitize.test.ts`

**Step 1: Write the failing test**

Create `test/unit/utils/sanitize.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { sanitizeFilename, deduplicateFilename } from "../../src/utils/sanitize";

describe("sanitizeFilename", () => {
  it("returns the filename unchanged if already safe", () => {
    expect(sanitizeFilename("statement.pdf")).toBe("statement.pdf");
  });

  it("removes path traversal sequences", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("..\\..\\windows\\system32")).toBe("system32");
  });

  it("replaces unsafe characters with underscores", () => {
    expect(sanitizeFilename('file<name>:with"bad|chars?.pdf')).toBe(
      "file_name__with_bad_chars_.pdf"
    );
  });

  it("truncates long filenames to 200 characters preserving extension", () => {
    const longName = "a".repeat(250) + ".pdf";
    const result = sanitizeFilename(longName);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result).toMatch(/\.pdf$/);
  });

  it("handles filenames with no extension", () => {
    const longName = "a".repeat(250);
    const result = sanitizeFilename(longName);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it("returns 'unnamed' for empty or whitespace-only input", () => {
    expect(sanitizeFilename("")).toBe("unnamed");
    expect(sanitizeFilename("   ")).toBe("unnamed");
  });

  it("strips leading/trailing dots and spaces", () => {
    expect(sanitizeFilename("  .hidden.pdf  ")).toBe("hidden.pdf");
  });
});

describe("deduplicateFilename", () => {
  it("returns original filename if no duplicates exist", () => {
    const result = deduplicateFilename("report.pdf", []);
    expect(result).toBe("report.pdf");
  });

  it("appends -1 if filename already exists", () => {
    const result = deduplicateFilename("report.pdf", ["report.pdf"]);
    expect(result).toBe("report-1.pdf");
  });

  it("increments suffix until unique", () => {
    const result = deduplicateFilename("report.pdf", [
      "report.pdf",
      "report-1.pdf",
      "report-2.pdf",
    ]);
    expect(result).toBe("report-3.pdf");
  });

  it("handles files with no extension", () => {
    const result = deduplicateFilename("readme", ["readme"]);
    expect(result).toBe("readme-1");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run test/unit/utils/sanitize.test.ts
```

Expected: FAIL — module not found.

**Step 3: Write implementation**

Create `src/utils/sanitize.ts`:

```typescript
const UNSAFE_CHARS = /[<>:"|?*\x00-\x1f]/g;
const MAX_FILENAME_LENGTH = 200;

export function sanitizeFilename(filename: string): string {
  let name = filename.trim();

  if (!name) return "unnamed";

  // Remove path traversal
  name = name.replace(/\.\.[/\\]/g, "");
  // Take only the last path segment
  name = name.split(/[/\\]/).pop() || "unnamed";
  // Strip leading dots and spaces
  name = name.replace(/^[\s.]+/, "");
  // Replace unsafe characters
  name = name.replace(UNSAFE_CHARS, "_");

  if (!name) return "unnamed";

  // Truncate preserving extension
  if (name.length > MAX_FILENAME_LENGTH) {
    const dotIndex = name.lastIndexOf(".");
    if (dotIndex > 0) {
      const ext = name.slice(dotIndex);
      const base = name.slice(0, MAX_FILENAME_LENGTH - ext.length);
      name = base + ext;
    } else {
      name = name.slice(0, MAX_FILENAME_LENGTH);
    }
  }

  return name;
}

export function deduplicateFilename(
  filename: string,
  existingNames: string[]
): string {
  if (!existingNames.includes(filename)) return filename;

  const dotIndex = filename.lastIndexOf(".");
  const hasExt = dotIndex > 0;
  const base = hasExt ? filename.slice(0, dotIndex) : filename;
  const ext = hasExt ? filename.slice(dotIndex) : "";

  let counter = 1;
  while (existingNames.includes(`${base}-${counter}${ext}`)) {
    counter++;
  }

  return `${base}-${counter}${ext}`;
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run test/unit/utils/sanitize.test.ts
```

Expected: All 9 tests PASS.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add filename sanitization utility"
```

---

## Task 6: Email Parser Service

**Files:**
- Create: `src/services/email-parser.ts`
- Create: `test/unit/services/email-parser.test.ts`
- Create: `test/fixtures/sample-email.eml`

**Step 1: Create a test fixture — a sample .eml file**

Create `test/fixtures/sample-email.eml`:

```
From: bank@example.com
To: creditcard@automation.example.com
Subject: Your March 2026 Credit Card Statement
Date: Sat, 15 Mar 2026 10:30:00 +0000
MIME-Version: 1.0
Message-ID: <unique-msg-id-123@example.com>
Content-Type: multipart/mixed; boundary="boundary123"

--boundary123
Content-Type: text/plain; charset="utf-8"

Your credit card statement for March 2026 is attached.

--boundary123
Content-Type: text/html; charset="utf-8"

<html><body><p>Your credit card statement for March 2026 is attached.</p></body></html>

--boundary123
Content-Type: application/pdf; name="statement-march-2026.pdf"
Content-Disposition: attachment; filename="statement-march-2026.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2Jq

--boundary123--
```

**Step 2: Write the failing test**

Create `test/unit/services/email-parser.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseEmail, type ParsedEmail } from "../../src/services/email-parser";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sampleEml = readFileSync(
  resolve(__dirname, "../../fixtures/sample-email.eml"),
  "utf-8"
);

describe("parseEmail", () => {
  it("extracts sender address", async () => {
    const result = await parseEmail(sampleEml);
    expect(result.from).toBe("bank@example.com");
  });

  it("extracts subject", async () => {
    const result = await parseEmail(sampleEml);
    expect(result.subject).toBe("Your March 2026 Credit Card Statement");
  });

  it("extracts date", async () => {
    const result = await parseEmail(sampleEml);
    expect(result.date).toBeTruthy();
  });

  it("extracts text body", async () => {
    const result = await parseEmail(sampleEml);
    expect(result.textBody).toContain("March 2026");
  });

  it("extracts HTML body", async () => {
    const result = await parseEmail(sampleEml);
    expect(result.htmlBody).toContain("<p>");
  });

  it("extracts attachments with filename and content type", async () => {
    const result = await parseEmail(sampleEml);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].filename).toBe("statement-march-2026.pdf");
    expect(result.attachments[0].contentType).toBe("application/pdf");
  });

  it("attachment content is an ArrayBuffer", async () => {
    const result = await parseEmail(sampleEml);
    expect(result.attachments[0].content).toBeInstanceOf(ArrayBuffer);
    expect(result.attachments[0].size).toBeGreaterThan(0);
  });
});
```

**Step 3: Run test to verify it fails**

```bash
npx vitest run test/unit/services/email-parser.test.ts
```

Expected: FAIL — module not found.

**Step 4: Write implementation**

Create `src/services/email-parser.ts`:

```typescript
import PostalMime from "postal-mime";

export interface ParsedAttachment {
  filename: string;
  contentType: string;
  content: ArrayBuffer;
  size: number;
}

export interface ParsedEmail {
  from: string;
  subject: string;
  date: string | null;
  messageId: string | null;
  textBody: string | null;
  htmlBody: string | null;
  attachments: ParsedAttachment[];
}

export async function parseEmail(rawEmail: string | ArrayBuffer): Promise<ParsedEmail> {
  const parser = new PostalMime();
  const parsed = await parser.parse(rawEmail);

  return {
    from: parsed.from?.address || parsed.from?.name || "unknown",
    subject: parsed.subject || "",
    date: parsed.date || null,
    messageId: parsed.messageId || null,
    textBody: parsed.text || null,
    htmlBody: parsed.html || null,
    attachments: (parsed.attachments || []).map((att) => ({
      filename: att.filename || "unnamed",
      contentType: att.mimeType || "application/octet-stream",
      content: att.content,
      size: att.content.byteLength,
    })),
  };
}
```

**Step 5: Run test to verify it passes**

```bash
npx vitest run test/unit/services/email-parser.test.ts
```

Expected: All 7 tests PASS.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add email parser service using postal-mime"
```

---

## Task 7: Storage Service

**Files:**
- Create: `src/services/storage.ts`

This service wraps R2 uploads. It's thin enough that we test it via integration tests rather than mocking R2 internals.

**Step 1: Write implementation**

Create `src/services/storage.ts`:

```typescript
import type { ParsedEmail } from "./email-parser";
import { sanitizeFilename, deduplicateFilename } from "../utils/sanitize";

export interface StorageResult {
  rawKey: string;
  bodyHtmlKey: string | null;
  bodyTextKey: string | null;
  attachmentKeys: { filename: string; storageKey: string; size: number; contentType: string }[];
}

export async function storeEmail(
  bucket: R2Bucket,
  storagePrefix: string,
  rawEmailData: ArrayBuffer | string,
  parsed: ParsedEmail
): Promise<StorageResult> {
  const rawKey = `${storagePrefix}/raw.eml`;

  // Store raw email first (preserve original no matter what)
  const rawBody =
    typeof rawEmailData === "string"
      ? new TextEncoder().encode(rawEmailData)
      : rawEmailData;
  await bucket.put(rawKey, rawBody);

  // Parallel uploads for parsed content and attachments
  const uploads: Promise<void>[] = [];
  let bodyHtmlKey: string | null = null;
  let bodyTextKey: string | null = null;

  if (parsed.htmlBody) {
    bodyHtmlKey = `${storagePrefix}/body.html`;
    uploads.push(
      bucket.put(bodyHtmlKey, new TextEncoder().encode(parsed.htmlBody)).then(() => {})
    );
  }

  if (parsed.textBody) {
    bodyTextKey = `${storagePrefix}/body.txt`;
    uploads.push(
      bucket.put(bodyTextKey, new TextEncoder().encode(parsed.textBody)).then(() => {})
    );
  }

  const existingNames: string[] = [];
  const attachmentKeys: StorageResult["attachmentKeys"] = [];

  for (const att of parsed.attachments) {
    const safeName = sanitizeFilename(att.filename);
    const uniqueName = deduplicateFilename(safeName, existingNames);
    existingNames.push(uniqueName);

    const storageKey = `${storagePrefix}/attachments/${uniqueName}`;
    attachmentKeys.push({
      filename: uniqueName,
      storageKey,
      size: att.size,
      contentType: att.contentType,
    });

    uploads.push(
      bucket
        .put(storageKey, att.content, {
          httpMetadata: { contentType: att.contentType },
        })
        .then(() => {})
    );
  }

  await Promise.all(uploads);

  return { rawKey, bodyHtmlKey, bodyTextKey, attachmentKeys };
}
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: add R2 storage service"
```

---

## Task 8: Queue Publisher Service

**Files:**
- Create: `src/services/queue.ts`

**Step 1: Write implementation**

Create `src/services/queue.ts`:

```typescript
import { generateUlid } from "../utils/ulid";
import type { StorageResult } from "./storage";

export interface EmailProcessedEvent {
  eventType: "email.received";
  eventId: string;
  timestamp: string;
  emailId: string;
  typeId: string;
  typeName: string;
  from: string;
  subject: string;
  receivedAt: string;
  storagePrefix: string;
  bodyHtmlKey: string | null;
  bodyTextKey: string | null;
  attachments: {
    id: string;
    filename: string;
    contentType: string;
    size: number;
    storageKey: string;
  }[];
}

export async function publishEmailEvent(
  queue: Queue<unknown>,
  params: {
    emailId: string;
    typeId: string;
    typeName: string;
    from: string;
    subject: string;
    receivedAt: string;
    storagePrefix: string;
    storageResult: StorageResult;
    attachmentIds: string[];
  }
): Promise<void> {
  const event: EmailProcessedEvent = {
    eventType: "email.received",
    eventId: generateUlid(),
    timestamp: new Date().toISOString(),
    emailId: params.emailId,
    typeId: params.typeId,
    typeName: params.typeName,
    from: params.from,
    subject: params.subject,
    receivedAt: params.receivedAt,
    storagePrefix: params.storagePrefix,
    bodyHtmlKey: params.storageResult.bodyHtmlKey,
    bodyTextKey: params.storageResult.bodyTextKey,
    attachments: params.storageResult.attachmentKeys.map((att, i) => ({
      id: params.attachmentIds[i],
      filename: att.filename,
      contentType: att.contentType,
      size: att.size,
      storageKey: att.storageKey,
    })),
  };

  await queue.send(event);
}
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: add queue publisher service"
```

---

## Task 9: Email Handler

**Files:**
- Create: `src/handlers/email.ts`

**Step 1: Write implementation**

Create `src/handlers/email.ts`:

```typescript
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { Env } from "../env";
import { generateUlid } from "../utils/ulid";
import { parseEmail } from "../services/email-parser";
import { storeEmail } from "../services/storage";
import { publishEmailEvent } from "../services/queue";

function extractLocalPart(address: string): string {
  const atIndex = address.indexOf("@");
  return atIndex > 0 ? address.slice(0, atIndex).toLowerCase() : address.toLowerCase();
}

function buildStoragePrefix(typeId: string, date: Date, emailId: string): string {
  const yyyy = date.getFullYear().toString();
  const mm = (date.getMonth() + 1).toString().padStart(2, "0");
  const dd = date.getDate().toString().padStart(2, "0");
  return `${typeId}/${yyyy}/${mm}/${dd}/${emailId}`;
}

export async function handleEmail(
  message: ForwardableEmailMessage,
  env: Env
): Promise<void> {
  const db = drizzle(env.EMAIL_DB, { schema });
  const emailId = generateUlid();
  const toAddress = message.to;
  const fromAddress = message.from;

  // Read raw email
  const rawEmail = await new Response(message.raw).arrayBuffer();

  // Resolve type
  const localPart = extractLocalPart(toAddress);
  let emailType = await db.query.emailTypes.findFirst({
    where: eq(schema.emailTypes.emailPrefix, localPart),
  });

  // If no type found, use "unknown"
  if (!emailType) {
    // Ensure "unknown" type exists
    const unknownType = await db.query.emailTypes.findFirst({
      where: eq(schema.emailTypes.id, "unknown"),
    });
    if (!unknownType) {
      await db.insert(schema.emailTypes).values({
        id: "unknown",
        emailPrefix: "__unknown__",
        displayName: "Unknown",
        description: "Emails with no matching type mapping",
        active: 1,
      });
    }
    emailType = {
      id: "unknown",
      emailPrefix: "__unknown__",
      displayName: "Unknown",
      description: "Emails with no matching type mapping",
      active: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // Parse email
  let parsed;
  try {
    parsed = await parseEmail(rawEmail);
  } catch (err) {
    // Store raw email even if parsing fails
    const storagePrefix = buildStoragePrefix(
      emailType.id,
      new Date(),
      emailId
    );
    await env.EMAIL_STORAGE.put(`${storagePrefix}/raw.eml`, rawEmail);

    await db.insert(schema.emails).values({
      id: emailId,
      typeId: emailType.id,
      fromAddress,
      toAddress,
      subject: null,
      receivedAt: new Date().toISOString(),
      storagePrefix,
      rawSize: rawEmail.byteLength,
      status: "failed",
      errorMessage: `Email parsing failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  const receivedAt = parsed.date || new Date().toISOString();
  const emailDate = new Date(receivedAt);
  const storagePrefix = buildStoragePrefix(emailType.id, emailDate, emailId);

  // Store to R2
  const storageResult = await storeEmail(
    env.EMAIL_STORAGE,
    storagePrefix,
    rawEmail,
    parsed
  );

  // Save metadata to D1
  const attachmentIds: string[] = [];

  await db.batch([
    db.insert(schema.emails).values({
      id: emailId,
      typeId: emailType.id,
      fromAddress,
      toAddress,
      subject: parsed.subject,
      receivedAt,
      storagePrefix,
      rawSize: rawEmail.byteLength,
      status: "received",
    }),
    ...storageResult.attachmentKeys.map((att) => {
      const attId = generateUlid();
      attachmentIds.push(attId);
      return db.insert(schema.attachments).values({
        id: attId,
        emailId,
        filename: att.filename,
        contentType: att.contentType,
        size: att.size,
        storageKey: att.storageKey,
      });
    }),
  ]);

  // Publish to queue
  try {
    await publishEmailEvent(env.EMAIL_QUEUE, {
      emailId,
      typeId: emailType.id,
      typeName: emailType.displayName,
      from: fromAddress,
      subject: parsed.subject,
      receivedAt,
      storagePrefix,
      storageResult,
      attachmentIds,
    });
  } catch (err) {
    // Email is saved — queue failure is non-fatal
    console.error("Queue publish failed:", err);
  }
}
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: add email ingestion handler"
```

---

## Task 10: Queue Consumer Handler (Stub)

**Files:**
- Create: `src/handlers/queue.ts`

**Step 1: Write implementation**

Create `src/handlers/queue.ts`:

```typescript
import type { Env } from "../env";
import type { EmailProcessedEvent } from "../services/queue";

export async function handleQueue(
  batch: MessageBatch<EmailProcessedEvent>,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    try {
      const event = message.body;
      console.log(
        `Processing event: ${event.eventType} for email ${event.emailId} (type: ${event.typeId})`
      );
      // Future: OCR, data extraction, forwarding, etc.
      message.ack();
    } catch (err) {
      console.error("Queue message processing failed:", err);
      message.retry();
    }
  }
}
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: add queue consumer handler stub"
```

---

## Task 11: Hono App — Auth Middleware

**Files:**
- Create: `src/api/middleware/auth.ts`
- Create: `test/unit/api/middleware/auth.test.ts`

**Step 1: Write the failing test**

Create `test/unit/api/middleware/auth.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { apiKeyAuth } from "../../../src/api/middleware/auth";
import type { Env } from "../../../src/env";

function createTestApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use("/*", apiKeyAuth());
  app.get("/test", (c) => c.json({ ok: true }));
  return app;
}

describe("apiKeyAuth middleware", () => {
  it("returns 401 when no API key is provided", async () => {
    const app = createTestApp();
    const res = await app.request("/test", {}, { API_KEY: "secret-key" } as unknown as Env);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Missing API key");
  });

  it("returns 403 when API key is invalid", async () => {
    const app = createTestApp();
    const res = await app.request(
      "/test",
      { headers: { "X-API-Key": "wrong-key" } },
      { API_KEY: "secret-key" } as unknown as Env
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Invalid API key");
  });

  it("passes through when API key is valid", async () => {
    const app = createTestApp();
    const res = await app.request(
      "/test",
      { headers: { "X-API-Key": "secret-key" } },
      { API_KEY: "secret-key" } as unknown as Env
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run test/unit/api/middleware/auth.test.ts
```

Expected: FAIL — module not found.

**Step 3: Write implementation**

Create `src/api/middleware/auth.ts`:

```typescript
import { createMiddleware } from "hono/factory";
import type { Env } from "../../env";

export function apiKeyAuth() {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const apiKey = c.req.header("X-API-Key");

    if (!apiKey) {
      return c.json({ error: "Missing API key" }, 401);
    }

    if (apiKey !== c.env.API_KEY) {
      return c.json({ error: "Invalid API key" }, 403);
    }

    await next();
  });
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run test/unit/api/middleware/auth.test.ts
```

Expected: All 3 tests PASS.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add API key auth middleware"
```

---

## Task 12: Health Route

**Files:**
- Create: `src/api/routes/health.ts`
- Create: `test/unit/api/routes/health.test.ts`

**Step 1: Write the failing test**

Create `test/unit/api/routes/health.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { healthRoute } from "../../../src/api/routes/health";
import type { Env } from "../../../src/env";

describe("GET /api/health", () => {
  it("returns status ok", async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.route("/api/health", healthRoute);

    const res = await app.request("/api/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run test/unit/api/routes/health.test.ts
```

Expected: FAIL — module not found.

**Step 3: Write implementation**

Create `src/api/routes/health.ts`:

```typescript
import { Hono } from "hono";
import type { Env } from "../../env";

export const healthRoute = new Hono<{ Bindings: Env }>();

healthRoute.get("/", (c) => {
  return c.json({
    status: "ok",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run test/unit/api/routes/health.test.ts
```

Expected: 1 test PASS.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add health check route"
```

---

## Task 13: Types API Routes

**Files:**
- Create: `src/api/routes/types.ts`
- Create: `test/unit/api/routes/types.test.ts`

**Step 1: Write the failing tests**

Create `test/unit/api/routes/types.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../src/db/schema";
import { typesRoute } from "../../../src/api/routes/types";
import type { Env } from "../../../src/env";

const db = drizzle(env.EMAIL_DB, { schema });

function createApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api/types", typesRoute);
  return app;
}

describe("Types API", () => {
  beforeEach(async () => {
    // Clean up tables between tests
    await env.EMAIL_DB.exec("DELETE FROM attachments");
    await env.EMAIL_DB.exec("DELETE FROM emails");
    await env.EMAIL_DB.exec("DELETE FROM email_types");
  });

  describe("POST /api/types", () => {
    it("creates a new email type", async () => {
      const app = createApp();
      const res = await app.request(
        "/api/types",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: "creditcard",
            emailPrefix: "creditcard",
            displayName: "Credit Card Statement",
            description: "Monthly credit card statements",
          }),
        },
        env as unknown as Env
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.id).toBe("creditcard");
      expect(body.data.displayName).toBe("Credit Card Statement");
    });

    it("returns 400 when required fields are missing", async () => {
      const app = createApp();
      const res = await app.request(
        "/api/types",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: "test" }),
        },
        env as unknown as Env
      );

      expect(res.status).toBe(400);
    });

    it("returns 409 when email prefix already exists", async () => {
      const app = createApp();
      const payload = {
        id: "creditcard",
        emailPrefix: "creditcard",
        displayName: "Credit Card Statement",
      };

      await app.request(
        "/api/types",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        env as unknown as Env
      );

      const res = await app.request(
        "/api/types",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, id: "creditcard2" }),
        },
        env as unknown as Env
      );

      expect(res.status).toBe(409);
    });
  });

  describe("GET /api/types", () => {
    it("returns empty array when no types exist", async () => {
      const app = createApp();
      const res = await app.request("/api/types", {}, env as unknown as Env);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual([]);
    });

    it("returns all types", async () => {
      await db.insert(schema.emailTypes).values({
        id: "creditcard",
        emailPrefix: "creditcard",
        displayName: "Credit Card",
      });

      const app = createApp();
      const res = await app.request("/api/types", {}, env as unknown as Env);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe("creditcard");
    });
  });

  describe("GET /api/types/:id", () => {
    it("returns a single type with email count", async () => {
      await db.insert(schema.emailTypes).values({
        id: "payslip",
        emailPrefix: "payslip",
        displayName: "Payslip",
      });

      const app = createApp();
      const res = await app.request(
        "/api/types/payslip",
        {},
        env as unknown as Env
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe("payslip");
      expect(body.data.emailCount).toBe(0);
    });

    it("returns 404 for non-existent type", async () => {
      const app = createApp();
      const res = await app.request(
        "/api/types/nonexistent",
        {},
        env as unknown as Env
      );
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/types/:id", () => {
    it("updates display name", async () => {
      await db.insert(schema.emailTypes).values({
        id: "creditcard",
        emailPrefix: "creditcard",
        displayName: "Credit Card",
      });

      const app = createApp();
      const res = await app.request(
        "/api/types/creditcard",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: "CC Statement" }),
        },
        env as unknown as Env
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.displayName).toBe("CC Statement");
    });

    it("returns 404 when type does not exist", async () => {
      const app = createApp();
      const res = await app.request(
        "/api/types/nonexistent",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: "Test" }),
        },
        env as unknown as Env
      );
      expect(res.status).toBe(404);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run test/unit/api/routes/types.test.ts
```

Expected: FAIL — module not found.

**Step 3: Write implementation**

Create `src/api/routes/types.ts`:

```typescript
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, sql, count } from "drizzle-orm";
import * as schema from "../../db/schema";
import type { Env } from "../../env";

export const typesRoute = new Hono<{ Bindings: Env }>();

// GET /api/types — list all types
typesRoute.get("/", async (c) => {
  const db = drizzle(c.env.EMAIL_DB, { schema });
  const types = await db.select().from(schema.emailTypes);
  return c.json({ data: types });
});

// GET /api/types/:id — get type with email count
typesRoute.get("/:id", async (c) => {
  const db = drizzle(c.env.EMAIL_DB, { schema });
  const id = c.req.param("id");

  const emailType = await db.query.emailTypes.findFirst({
    where: eq(schema.emailTypes.id, id),
  });

  if (!emailType) {
    return c.json({ error: "Type not found" }, 404);
  }

  const [countResult] = await db
    .select({ count: count() })
    .from(schema.emails)
    .where(eq(schema.emails.typeId, id));

  return c.json({
    data: { ...emailType, emailCount: countResult.count },
  });
});

// POST /api/types — create new type
typesRoute.post("/", async (c) => {
  const db = drizzle(c.env.EMAIL_DB, { schema });
  const body = await c.req.json<{
    id?: string;
    emailPrefix?: string;
    displayName?: string;
    description?: string;
  }>();

  if (!body.id || !body.emailPrefix || !body.displayName) {
    return c.json(
      { error: "Missing required fields: id, emailPrefix, displayName" },
      400
    );
  }

  // Check for duplicate emailPrefix
  const existing = await db.query.emailTypes.findFirst({
    where: eq(schema.emailTypes.emailPrefix, body.emailPrefix),
  });
  if (existing) {
    return c.json({ error: "Email prefix already exists" }, 409);
  }

  const [created] = await db
    .insert(schema.emailTypes)
    .values({
      id: body.id,
      emailPrefix: body.emailPrefix,
      displayName: body.displayName,
      description: body.description || null,
    })
    .returning();

  return c.json({ data: created }, 201);
});

// PATCH /api/types/:id — update type
typesRoute.patch("/:id", async (c) => {
  const db = drizzle(c.env.EMAIL_DB, { schema });
  const id = c.req.param("id");

  const existing = await db.query.emailTypes.findFirst({
    where: eq(schema.emailTypes.id, id),
  });
  if (!existing) {
    return c.json({ error: "Type not found" }, 404);
  }

  const body = await c.req.json<{
    displayName?: string;
    description?: string;
    active?: number;
  }>();

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (body.displayName !== undefined) updates.displayName = body.displayName;
  if (body.description !== undefined) updates.description = body.description;
  if (body.active !== undefined) updates.active = body.active;

  const [updated] = await db
    .update(schema.emailTypes)
    .set(updates)
    .where(eq(schema.emailTypes.id, id))
    .returning();

  return c.json({ data: updated });
});
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run test/unit/api/routes/types.test.ts
```

Expected: All 7 tests PASS.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add email types CRUD API routes"
```

---

## Task 14: Emails API Routes

**Files:**
- Create: `src/api/routes/emails.ts`
- Create: `test/unit/api/routes/emails.test.ts`

**Step 1: Write the failing tests**

Create `test/unit/api/routes/emails.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../src/db/schema";
import { emailsRoute } from "../../../src/api/routes/emails";
import type { Env } from "../../../src/env";

const db = drizzle(env.EMAIL_DB, { schema });

function createApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api/emails", emailsRoute);
  return app;
}

async function seedData() {
  await db.insert(schema.emailTypes).values({
    id: "creditcard",
    emailPrefix: "creditcard",
    displayName: "Credit Card",
  });

  await db.insert(schema.emails).values({
    id: "01ABC123",
    typeId: "creditcard",
    fromAddress: "bank@example.com",
    toAddress: "creditcard@auto.example.com",
    subject: "March Statement",
    receivedAt: "2026-03-15T10:30:00Z",
    storagePrefix: "creditcard/2026/03/15/01ABC123",
    rawSize: 1024,
    status: "received",
  });

  await db.insert(schema.attachments).values({
    id: "01ATT456",
    emailId: "01ABC123",
    filename: "statement.pdf",
    contentType: "application/pdf",
    size: 512,
    storageKey: "creditcard/2026/03/15/01ABC123/attachments/statement.pdf",
  });
}

describe("Emails API", () => {
  beforeEach(async () => {
    await env.EMAIL_DB.exec("DELETE FROM attachments");
    await env.EMAIL_DB.exec("DELETE FROM emails");
    await env.EMAIL_DB.exec("DELETE FROM email_types");
  });

  describe("GET /api/emails", () => {
    it("returns empty list when no emails", async () => {
      const app = createApp();
      const res = await app.request("/api/emails", {}, env as unknown as Env);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual([]);
      expect(body.pagination.total).toBe(0);
    });

    it("returns paginated emails", async () => {
      await seedData();
      const app = createApp();
      const res = await app.request("/api/emails", {}, env as unknown as Env);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe("01ABC123");
      expect(body.pagination.total).toBe(1);
    });

    it("filters by type", async () => {
      await seedData();
      const app = createApp();

      const res = await app.request(
        "/api/emails?type=creditcard",
        {},
        env as unknown as Env
      );
      const body = await res.json();
      expect(body.data).toHaveLength(1);

      const res2 = await app.request(
        "/api/emails?type=payslip",
        {},
        env as unknown as Env
      );
      const body2 = await res2.json();
      expect(body2.data).toHaveLength(0);
    });

    it("filters by date range", async () => {
      await seedData();
      const app = createApp();

      const res = await app.request(
        "/api/emails?from=2026-03-01&to=2026-03-31",
        {},
        env as unknown as Env
      );
      const body = await res.json();
      expect(body.data).toHaveLength(1);

      const res2 = await app.request(
        "/api/emails?from=2026-04-01",
        {},
        env as unknown as Env
      );
      const body2 = await res2.json();
      expect(body2.data).toHaveLength(0);
    });
  });

  describe("GET /api/emails/:id", () => {
    it("returns email with attachments", async () => {
      await seedData();
      const app = createApp();
      const res = await app.request(
        "/api/emails/01ABC123",
        {},
        env as unknown as Env
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe("01ABC123");
      expect(body.data.attachments).toHaveLength(1);
      expect(body.data.attachments[0].filename).toBe("statement.pdf");
    });

    it("returns 404 for non-existent email", async () => {
      const app = createApp();
      const res = await app.request(
        "/api/emails/nonexistent",
        {},
        env as unknown as Env
      );
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/emails/:id/attachments/:aid", () => {
    it("returns 404 when attachment does not exist", async () => {
      await seedData();
      const app = createApp();
      const res = await app.request(
        "/api/emails/01ABC123/attachments/nonexistent",
        {},
        env as unknown as Env
      );
      expect(res.status).toBe(404);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run test/unit/api/routes/emails.test.ts
```

Expected: FAIL — module not found.

**Step 3: Write implementation**

Create `src/api/routes/emails.ts`:

```typescript
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, gte, lte, count, desc } from "drizzle-orm";
import * as schema from "../../db/schema";
import type { Env } from "../../env";

export const emailsRoute = new Hono<{ Bindings: Env }>();

// GET /api/emails — list emails with filters and pagination
emailsRoute.get("/", async (c) => {
  const db = drizzle(c.env.EMAIL_DB, { schema });

  const type = c.req.query("type");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const status = c.req.query("status");
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "20", 10)));
  const offset = (page - 1) * limit;

  const conditions = [];
  if (type) conditions.push(eq(schema.emails.typeId, type));
  if (status) conditions.push(eq(schema.emails.status, status));
  if (from) conditions.push(gte(schema.emails.receivedAt, from));
  if (to) conditions.push(lte(schema.emails.receivedAt, to + "T23:59:59Z"));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalResult] = await db
    .select({ count: count() })
    .from(schema.emails)
    .where(where);

  const data = await db
    .select()
    .from(schema.emails)
    .where(where)
    .orderBy(desc(schema.emails.receivedAt))
    .limit(limit)
    .offset(offset);

  return c.json({
    data,
    pagination: {
      page,
      limit,
      total: totalResult.count,
      totalPages: Math.ceil(totalResult.count / limit),
    },
  });
});

// GET /api/emails/:id — get email details with attachments
emailsRoute.get("/:id", async (c) => {
  const db = drizzle(c.env.EMAIL_DB, { schema });
  const id = c.req.param("id");

  const email = await db.query.emails.findFirst({
    where: eq(schema.emails.id, id),
  });

  if (!email) {
    return c.json({ error: "Email not found" }, 404);
  }

  const emailAttachments = await db
    .select()
    .from(schema.attachments)
    .where(eq(schema.attachments.emailId, id));

  return c.json({ data: { ...email, attachments: emailAttachments } });
});

// GET /api/emails/:id/attachments/:aid — download attachment
emailsRoute.get("/:id/attachments/:aid", async (c) => {
  const db = drizzle(c.env.EMAIL_DB, { schema });
  const emailId = c.req.param("id");
  const attachmentId = c.req.param("aid");

  const attachment = await db.query.attachments.findFirst({
    where: and(
      eq(schema.attachments.id, attachmentId),
      eq(schema.attachments.emailId, emailId)
    ),
  });

  if (!attachment) {
    return c.json({ error: "Attachment not found" }, 404);
  }

  const object = await c.env.EMAIL_STORAGE.get(attachment.storageKey);
  if (!object) {
    return c.json({ error: "Attachment file not found in storage" }, 404);
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": attachment.contentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${attachment.filename}"`,
      "Content-Length": (attachment.size || 0).toString(),
    },
  });
});
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run test/unit/api/routes/emails.test.ts
```

Expected: All 6 tests PASS.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add emails API routes with filtering and pagination"
```

---

## Task 15: Hono App Assembly

**Files:**
- Create: `src/api/app.ts`

**Step 1: Write implementation**

Create `src/api/app.ts`:

```typescript
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
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: assemble Hono app with routes and middleware"
```

---

## Task 16: Worker Entry Point with Sentry

**Files:**
- Create: `src/index.ts`

**Step 1: Write implementation**

Create `src/index.ts`:

```typescript
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
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: add worker entry point with Sentry integration"
```

---

## Task 17: Integration Test — Full Email Flow

**Files:**
- Create: `test/integration/email-flow.test.ts`

**Step 1: Write integration test**

Create `test/integration/email-flow.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { app } from "../../src/api/app";
import type { Env } from "../../src/env";

const db = drizzle(env.EMAIL_DB, { schema });

describe("Integration: Email API flow", () => {
  beforeEach(async () => {
    await env.EMAIL_DB.exec("DELETE FROM attachments");
    await env.EMAIL_DB.exec("DELETE FROM emails");
    await env.EMAIL_DB.exec("DELETE FROM email_types");
  });

  it("full flow: create type → verify via API → list types", async () => {
    // Create a type
    const createRes = await app.request(
      "/api/types",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "test-api-key-12345",
        },
        body: JSON.stringify({
          id: "creditcard",
          emailPrefix: "creditcard",
          displayName: "Credit Card Statement",
          description: "Monthly CC statements",
        }),
      },
      env as unknown as Env
    );
    expect(createRes.status).toBe(201);

    // List types
    const listRes = await app.request(
      "/api/types",
      { headers: { "X-API-Key": "test-api-key-12345" } },
      env as unknown as Env
    );
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.data).toHaveLength(1);

    // Get single type
    const getRes = await app.request(
      "/api/types/creditcard",
      { headers: { "X-API-Key": "test-api-key-12345" } },
      env as unknown as Env
    );
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.data.displayName).toBe("Credit Card Statement");
    expect(getBody.data.emailCount).toBe(0);
  });

  it("emails endpoint returns 401 without API key", async () => {
    const res = await app.request(
      "/api/emails",
      {},
      env as unknown as Env
    );
    expect(res.status).toBe(401);
  });

  it("health endpoint does not require auth", async () => {
    const res = await app.request(
      "/api/health",
      {},
      env as unknown as Env
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});
```

**Step 2: Run all tests**

```bash
npx vitest run
```

Expected: All unit and integration tests PASS.

**Step 3: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: No type errors.

**Step 4: Commit**

```bash
git add -A
git commit -m "test: add integration tests for email API flow"
```

---

## Task 18: Final Verification & Cleanup

**Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

**Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

**Step 3: Verify local dev server starts**

```bash
npx wrangler dev --local
```

Expected: Server starts, health endpoint responds at `http://localhost:8787/api/health`.

**Step 4: Test health endpoint**

```bash
curl http://localhost:8787/api/health
```

Expected: `{"status":"ok","version":"1.0.0","timestamp":"..."}`

**Step 5: Final commit with any cleanup**

```bash
git add -A
git commit -m "chore: final cleanup and verification"
```
