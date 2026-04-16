# Email Worker — Design Document

**Date:** 2026-04-16
**Status:** Approved

## Problem

Automate the capture and storage of important emails (bank statements, payslips, marketplace transactions, etc.) by forwarding them from Gmail/Outlook via mail rules to a Cloudflare Email Worker. The worker stores raw content and attachments, extracts basic metadata, and publishes events for downstream async processing.

## Architecture

**Single Cloudflare Worker** handling three entry points:

- `email()` — receives forwarded emails via Cloudflare Email Routing
- `fetch()` — serves a REST API via Hono framework
- `queue()` — consumes events from Cloudflare Queue (for future downstream processing)

```
Gmail/Outlook → Mail Rule → Cloudflare Email Routing → Worker (email handler)
                                                          ├── Parse email (postal-mime)
                                                          ├── Resolve document type (D1 lookup)
                                                          ├── Store raw + parsed content to R2
                                                          ├── Save metadata to D1 (via Drizzle ORM)
                                                          └── Publish event to Cloudflare Queue
                                                                └── Consumer Worker (future)

HTTP Client → Worker (fetch handler / Hono)
                ├── GET  /api/emails        — list/search emails
                ├── GET  /api/emails/:id    — get email details + attachments
                ├── GET  /api/emails/:id/attachments/:aid — download attachment
                ├── GET  /api/types         — list document types
                ├── GET  /api/types/:id     — get type details
                ├── POST /api/types         — create new type mapping
                ├── PATCH /api/types/:id    — update type mapping
                └── GET  /api/health        — health check
```

### Cloudflare Bindings

| Binding | Type | Name | Purpose |
|---------|------|------|---------|
| R2 Bucket | `R2Bucket` | `EMAIL_STORAGE` | Raw emails + attachments |
| D1 Database | `D1Database` | `EMAIL_DB` | Metadata, type mappings |
| Queue Producer | `Queue` | `EMAIL_QUEUE` | Event publishing |
| Secret | `string` | `API_KEY` | REST API authentication |
| Secret | `string` | `SENTRY_DSN` | Sentry error tracking |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Cloudflare Workers |
| Language | TypeScript |
| HTTP Framework | Hono |
| ORM | Drizzle ORM (D1 driver) |
| Email Parsing | postal-mime |
| Object Storage | Cloudflare R2 |
| Database | Cloudflare D1 (SQLite) |
| Message Queue | Cloudflare Queues |
| Error Tracking | Sentry (@sentry/cloudflare) |
| Testing | Vitest + Miniflare |
| Tooling | Wrangler |
| Local Dev | Docker Compose |

## Data Model (Drizzle ORM)

### email_types

Dynamic mapping from email address prefix to document type.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | e.g., `creditcard` |
| email_prefix | TEXT UNIQUE | local part of automation address |
| display_name | TEXT | Human-readable name |
| description | TEXT | Optional description |
| active | INTEGER | 1 = active, 0 = inactive |
| created_at | TEXT | ISO 8601 timestamp |
| updated_at | TEXT | ISO 8601 timestamp |

### emails

One row per received email.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | ULID (time-sortable) |
| type_id | TEXT FK | → email_types.id |
| from_address | TEXT | Sender address |
| to_address | TEXT | Automation address |
| subject | TEXT | Email subject |
| received_at | TEXT | Original email date |
| storage_prefix | TEXT | Base path in object storage |
| raw_size | INTEGER | Total size in bytes |
| status | TEXT | `received` / `processed` / `failed` |
| error_message | TEXT | Error details if status=failed |
| created_at | TEXT | ISO 8601 timestamp |

### attachments

One row per attachment.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | ULID |
| email_id | TEXT FK | → emails.id |
| filename | TEXT | Sanitized original filename |
| content_type | TEXT | MIME type |
| size | INTEGER | Size in bytes |
| storage_key | TEXT | Full object key in storage |
| created_at | TEXT | ISO 8601 timestamp |

### Indexes

- `idx_emails_type` on `emails(type_id)`
- `idx_emails_received` on `emails(received_at)`
- `idx_emails_status` on `emails(status)`
- `idx_attachments_email` on `attachments(email_id)`

## R2 Storage Structure

```
email-storage/
├── {type}/
│   └── {YYYY}/
│       └── {MM}/
│           └── {DD}/
│               └── {email-ulid}/
│                   ├── raw.eml              # original email
│                   ├── body.html            # extracted HTML body
│                   ├── body.txt             # extracted plain text body
│                   └── attachments/
│                       ├── statement.pdf
│                       └── receipt.png
```

Filenames are sanitized (no path traversal, length-limited, duplicates get `-1`, `-2` suffix).

## Email Processing Pipeline

1. **Receive** — extract from, to, subject, date, headers
2. **Resolve type** — parse local part from to-address, look up `email_types` in D1
   - Unknown prefix → stored as type `unknown`
   - Inactive type → stored with warning
3. **Generate IDs** — ULID for email, compute storage prefix
4. **Parse email** — extract bodies and attachments via `postal-mime`
5. **Store to R2** — upload `raw.eml` first (preserve original no matter what), then parsed content and attachments (parallel uploads)
6. **Save to D1** — insert into `emails` and `attachments` tables in a single transaction
7. **Publish to queue** — enqueue `EmailProcessedEvent`
8. **Respond** — accept the email (return void)

## Queue Event Schema

```typescript
interface EmailProcessedEvent {
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
```

Queue configuration:
- Batch size: up to 10 messages
- Max retries: 3
- Failed messages logged to D1 with `status: 'failed'`

## REST API

**Authentication:** API key via `X-API-Key` header, checked against `API_KEY` secret.

**Framework:** Hono with middleware for auth, error handling, and CORS.

**Response format:** `{ data, pagination?, error? }`

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/emails` | List emails (filter by type, date range, status; paginated) |
| GET | `/api/emails/:id` | Get email with attachment list |
| GET | `/api/emails/:id/attachments/:aid` | Download attachment (presigned URL or stream) |
| GET | `/api/types` | List all document types |
| GET | `/api/types/:id` | Get type details with email count |
| POST | `/api/types` | Create new type mapping |
| PATCH | `/api/types/:id` | Update type mapping |
| GET | `/api/health` | Health check |

No DELETE endpoints — emails are append-only.

## Error Handling

| Failure | Strategy |
|---------|----------|
| Email parsing fails | Store raw.eml anyway, set status=`failed`, report to Sentry |
| R2 upload fails | Retry once, then mark as `failed`, report to Sentry |
| D1 write fails | R2 data orphaned — raw.eml preserved for recovery, report to Sentry |
| Queue publish fails | Email stored but event missed — reconciliation job can re-publish |
| Unknown email type | Store under type `unknown`, process normally |
| Large attachments | Stream to R2 (supports up to 5GB) |

### Sentry Integration

Using `@sentry/cloudflare` SDK wrapping all three handlers. Reports:
- Processing failures with email metadata context (not content, for privacy)
- API errors (4xx/5xx)
- Unhandled exceptions
- Breadcrumbs for each processing step

## Testing Strategy

- **Unit tests** (Vitest): Email parsing, type resolution, filename sanitization, route handlers
- **Integration tests** (Miniflare): Full email → R2 → D1 → Queue flow with local emulation
- **API tests**: Hono route testing with mock bindings

## Local Development (Docker Compose)

Docker Compose for consistent development environments. A single `docker compose up` starts everything:

- **worker** service: Node.js container running `wrangler dev --local`
- Source code mounted as a volume for live reload
- Port 8787 exposed for HTTP access
- Miniflare emulates R2, D1, and Queues inside the container — no external services needed

```yaml
# docker-compose.yml
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

```dockerfile
# Dockerfile.dev
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
CMD ["npx", "wrangler", "dev", "--local", "--ip", "0.0.0.0"]
```

## Volume Expectations

50–500 emails/day. Well within Cloudflare Workers free/paid tier limits.
