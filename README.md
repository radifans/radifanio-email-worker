# radifanio-email-worker

A Cloudflare Worker that receives forwarded emails, stores their content and attachments in R2, saves metadata to D1, and publishes events to Cloudflare Queues — with a Hono REST API for querying.

## Architecture

```
Inbound Email
      │
      ▼
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  email()    │────▶│  R2 Storage  │     │  D1 Database │
│  handler    │────▶│  (raw + body │     │  (metadata)  │
└─────────────┘     │  + attachments)    └──────────────┘
      │             └──────────────┘            ▲
      │                                         │
      └─────────────────────────────────────────┘
      │
      ▼
┌─────────────┐
│   Queue     │  email-events
│  producer   │────────────────▶ queue() consumer (stub)
└─────────────┘

HTTP Requests
      │
      ▼
┌─────────────┐
│  fetch()    │  Hono REST API  (/api/health, /api/types, /api/emails)
│  handler    │
└─────────────┘
```

The worker has three handlers:

- **`email()`** — receives forwarded emails, parses them with postal-mime, stores content to R2, writes metadata to D1, and publishes an `email.received` event to a Queue
- **`fetch()`** — Hono REST API for querying email metadata and downloading attachments
- **`queue()`** — stub consumer for downstream processing (OCR, extraction, forwarding, etc.)

## Tech Stack

| Tool | Purpose |
|------|---------|
| [Cloudflare Workers](https://workers.cloudflare.com/) | Runtime |
| [Hono](https://hono.dev/) | HTTP framework |
| [Drizzle ORM](https://orm.drizzle.team/) | D1 (SQLite) ORM |
| [postal-mime](https://github.com/postalsys/postal-mime) | Email parsing |
| [ulid](https://github.com/ulid/javascript) | Sortable unique IDs |
| [@sentry/cloudflare](https://docs.sentry.io/platforms/javascript/guides/cloudflare/) | Error tracking |
| [Vitest](https://vitest.dev/) + [@cloudflare/vitest-pool-workers](https://github.com/cloudflare/workers-sdk/tree/main/packages/vitest-pool-workers) | Testing |

## Project Structure

```
src/
├── index.ts                  # Worker entry point (Sentry-wrapped handlers)
├── env.ts                    # Env bindings type
├── db/
│   └── schema.ts             # Drizzle table definitions
├── services/
│   ├── email-parser.ts       # postal-mime wrapper
│   ├── storage.ts            # R2 upload abstraction
│   └── queue.ts              # Queue event publisher
├── handlers/
│   ├── email.ts              # email() handler logic
│   └── queue.ts              # queue() consumer stub
├── api/
│   ├── app.ts                # Hono app assembly
│   ├── middleware/
│   │   └── auth.ts           # X-API-Key middleware
│   └── routes/
│       ├── health.ts         # GET /api/health
│       ├── types.ts          # CRUD /api/types
│       └── emails.ts         # GET /api/emails, /api/emails/:id
└── utils/
    ├── ulid.ts               # ULID generation
    └── sanitize.ts           # Filename sanitization
```

## Getting Started

### Prerequisites

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`)
- A Cloudflare account with Email Routing enabled

### Install

```bash
npm install
```

### Local Development

```bash
npm run dev
```

Or with Docker:

```bash
docker compose up
```

The worker runs at `http://localhost:8787`.

### Running Tests

```bash
npm test
```

Tests run inside a Miniflare environment (real Workers runtime) with an in-memory D1 database and R2. D1 migrations are applied automatically before each test run.

```bash
npm test           # run all tests once
npm run test:watch # watch mode
```

### Typecheck

```bash
npm run typecheck
```

## Deployment

### 1. Create Cloudflare resources

```bash
# Create D1 database
wrangler d1 create email-db

# Create R2 bucket
wrangler r2 bucket create email-storage

# Create Queue
wrangler queues create email-events
```

### 2. Update wrangler.toml

Replace `database_id = "placeholder-replace-after-creation"` with the ID output by `wrangler d1 create`.

### 3. Set secrets

```bash
wrangler secret put API_KEY        # your chosen API key for the REST API
wrangler secret put SENTRY_DSN     # your Sentry DSN (or leave empty to disable)
```

### 4. Run database migrations

```bash
npm run db:migrate:remote
```

### 5. Deploy

```bash
npm run deploy
```

### 6. Configure Email Routing

In the Cloudflare dashboard, set up Email Routing rules to forward emails to your worker. For example:

- `creditcard@yourdomain.com` → Worker
- `payslips@yourdomain.com` → Worker

## Database Schema

### `email_types`

Maps an email address prefix (e.g. `creditcard`) to a display name.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Unique identifier |
| `email_prefix` | TEXT UNIQUE | Local part of the destination address |
| `display_name` | TEXT | Human-readable name |
| `description` | TEXT | Optional description |
| `active` | INTEGER | 1 = active, 0 = disabled |

### `emails`

One row per received email.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | ULID |
| `type_id` | TEXT FK | References `email_types.id` |
| `from_address` | TEXT | Sender |
| `to_address` | TEXT | Recipient |
| `subject` | TEXT | Email subject |
| `received_at` | TEXT | ISO 8601 timestamp |
| `storage_prefix` | TEXT | R2 key prefix for all blobs |
| `raw_size` | INTEGER | Raw email size in bytes |
| `status` | TEXT | `received` or `failed` |
| `error_message` | TEXT | Set when `status = failed` |

### `attachments`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | ULID |
| `email_id` | TEXT FK | References `emails.id` |
| `filename` | TEXT | Sanitized filename |
| `content_type` | TEXT | MIME type |
| `size` | INTEGER | Bytes |
| `storage_key` | TEXT | Full R2 key |

### R2 Storage Layout

```
{type_id}/{yyyy}/{mm}/{dd}/{email_id}/
├── raw.eml
├── body.html
├── body.txt
└── attachments/
    ├── statement.pdf
    └── invoice.pdf
```

## API Reference

All endpoints except `/api/health` require the `X-API-Key` header.

### Health

```
GET /api/health
```

```json
{ "status": "ok", "version": "1.0.0", "timestamp": "..." }
```

### Email Types

```
GET    /api/types              List all types
GET    /api/types/:id          Get type + email count
POST   /api/types              Create type
PATCH  /api/types/:id          Update type
```

**Create type:**
```bash
curl -X POST https://your-worker.workers.dev/api/types \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"id":"creditcard","emailPrefix":"creditcard","displayName":"Credit Card Statements"}'
```

### Emails

```
GET /api/emails                          List emails (paginated)
GET /api/emails/:id                      Get email + attachments
GET /api/emails/:id/attachments/:aid     Download attachment
```

**Query parameters for `GET /api/emails`:**

| Param | Description | Example |
|-------|-------------|---------|
| `type` | Filter by type ID | `?type=creditcard` |
| `from` | Start date (inclusive) | `?from=2026-03-01` |
| `to` | End date (inclusive) | `?to=2026-03-31` |
| `status` | Filter by status | `?status=received` |
| `page` | Page number (default: 1) | `?page=2` |
| `limit` | Items per page (max: 100, default: 20) | `?limit=50` |

**Example response:**
```json
{
  "data": [
    {
      "id": "01JRXYZ...",
      "typeId": "creditcard",
      "fromAddress": "bank@example.com",
      "subject": "March 2026 Statement",
      "receivedAt": "2026-03-15T10:30:00Z",
      "status": "received"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

## Queue Events

Each successfully processed email publishes an `email.received` event to the `email-events` queue:

```typescript
{
  eventType: "email.received",
  eventId: string,          // ULID
  timestamp: string,        // ISO 8601
  emailId: string,
  typeId: string,
  typeName: string,
  from: string,
  subject: string,
  receivedAt: string,
  storagePrefix: string,
  bodyHtmlKey: string | null,
  bodyTextKey: string | null,
  attachments: Array<{
    id: string,
    filename: string,
    contentType: string,
    size: number,
    storageKey: string
  }>
}
```

Extend `src/handlers/queue.ts` to add downstream processing: OCR, data extraction, webhooks, forwarding, etc.

## Environment Bindings

| Binding | Type | Description |
|---------|------|-------------|
| `EMAIL_STORAGE` | R2Bucket | Stores raw emails, bodies, and attachments |
| `EMAIL_DB` | D1Database | SQLite metadata store (via Drizzle ORM) |
| `EMAIL_QUEUE` | Queue | Publishes `email.received` events |
| `API_KEY` | Secret | Authentication key for the REST API |
| `SENTRY_DSN` | Secret | Sentry DSN for error tracking (empty string to disable) |

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start local dev server via Wrangler |
| `npm test` | Run test suite |
| `npm run typecheck` | TypeScript type check |
| `npm run deploy:dev` | Deploy to `dev` environment |
| `npm run deploy:prod` | Deploy to `production` environment |
| `npm run db:generate` | Generate Drizzle migration files |
| `npm run db:migrate:local` | Apply migrations locally (uses dev DB) |
| `npm run db:migrate:dev` | Apply migrations to remote dev D1 |
| `npm run db:migrate:prod` | Apply migrations to remote production D1 |
