
# ReachInbox — Distributed Email Job Scheduler

A production-quality, full-stack distributed email job scheduler built with **Node.js, TypeScript, Express, BullMQ, Redis, PostgreSQL (Prisma), Elasticsearch, Nodemailer (Ethereal SMTP), Google OAuth 2.0, Slack OAuth 2.0, Bull Board, and React (Vite + Tailwind CSS + TanStack Query)**.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Technology Stack](#technology-stack)
3. [Architecture Diagram](#architecture-diagram)
4. [Folder Structure](#folder-structure)
5. [Prerequisites](#prerequisites)
6. [Quick Start with Docker Compose](#quick-start-with-docker-compose)
7. [Local Development Setup](#local-development-setup)
8. [OAuth & SMTP Setup Guides](#oauth--smtp-setup-guides)
9. [Environment Variables](#environment-variables)
10. [API Documentation](#api-documentation)
11. [Bull Board Queue Dashboard](#bull-board-queue-dashboard)
12. [Distributed Rate Limiting Algorithm & Trade-Offs](#distributed-rate-limiting-algorithm--trade-offs)
13. [Persistence, Restart Recovery & Idempotency](#persistence-restart-recovery--idempotency)
14. [Elasticsearch Indexing & Fallback](#elasticsearch-indexing--fallback)
15. [Slack Rate-Limit Notifications](#slack-rate-limit-notifications)
16. [Automated Testing](#automated-testing)
17. [5-Minute Demo Script](#5-minute-demo-script)
18. [Troubleshooting](#troubleshooting)

---

## Project Overview

ReachInbox reliably schedules, rate-limits, delivers, indexes, and monitors outbound email campaigns across multiple horizontally scalable worker processes:

- **PostgreSQL + Prisma** acts as the single source of truth with transactional outbox persistence.
- **BullMQ delayed jobs + Redis** schedule future deliveries without cron jobs, `node-cron`, Agenda, or OS timers.
- **Atomic Redis Lua scripts** enforce both per-sender minimum inter-email delay (`MIN_EMAIL_DELAY_MS`) and per-sender hourly sending quotas (`MAX_EMAILS_PER_HOUR_PER_SENDER`) across concurrent workers, rescheduling excess jobs to future hourly windows instead of dropping or failing them.
- **Real Google OAuth 2.0** secures dashboard sessions, API endpoints, and the Bull Board queue monitor via HTTP-only JWT cookies.
- **Real Slack OAuth 2.0** sends live workspace alerts when any sender hits its hourly limit (with Redis idempotency to avoid alert spam).
- **Elasticsearch** indexes scheduled, sent, and failed emails for fast user-scoped full-text search with automatic PostgreSQL fallback if Elasticsearch is temporarily unavailable.

---

## Technology Stack

### Backend
- **Runtime & Framework:** Node.js 22, TypeScript (strict mode), Express.js
- **Queues & Coordination:** BullMQ v5, Redis 7 (`ioredis`), Bull Board (`@bull-board/express`)
- **Database:** PostgreSQL 16, Prisma ORM v6
- **Email Transport:** Nodemailer + Ethereal Email SMTP
- **Search:** Elasticsearch 8
- **Auth & Security:** Google OAuth 2.0, Slack OAuth 2.0, JWT HTTP-only cookies, AES-256-GCM encryption at rest, Helmet, CORS, Zod validation
- **Logging & Testing:** Pino (`pino-http`), Vitest, Supertest

### Frontend
- **Framework:** React 18, Vite 6, TypeScript
- **Styling & Icons:** Tailwind CSS, Lucide React
- **Routing & State:** React Router v6, TanStack Query v5, Axios
- **Forms & Validation:** React Hook Form, Zod

### Infrastructure
- Docker & Docker Compose (PostgreSQL, Redis AOF persistence, Elasticsearch, Backend API, BullMQ Worker, Nginx-served Frontend)

---

## Architecture Diagram

```mermaid
flowchart TD
    User["User Browser (React + Vite)"] -->|Google OAuth / REST API| API["Express API Server"]
    User -->|Protected Session| Board["Bull Board (/admin/queues)"]
    API -->|Prisma Transaction + Outbox| PG["PostgreSQL 16"]
    API -->|Enqueue Delayed Jobs (jobId=emailId)| Redis["Redis 7 (AOF Persistence)"]
    API -->|Search Queries| ES["Elasticsearch 8"]
    API -->|Fallback Search if ES Down| PG

    Worker["BullMQ Worker Process (Configurable Concurrency)"] -->|Dequeue Delayed Jobs| Redis
    Worker -->|Atomic Lua Rate Limiter & Locks| Redis
    Worker -->|State Sync & Campaign Status| PG
    Worker -->|Send Email| SMTP["Ethereal / SMTP Server"]
    Worker -->|Hourly Limit Alert| Slack["Slack Workspace (OAuth Webhook / API)"]
    Worker -->|Async Index Jobs| ES
```

---

## Folder Structure

```text
reachinbox-email-scheduler/
├── apps/
│   ├── backend/
│   │   ├── prisma/
│   │   │   ├── migrations/
│   │   │   └── schema.prisma
│   │   ├── src/
│   │   │   ├── config/          # Zod env config, Pino logger, Prisma, Redis
│   │   │   ├── controllers/     # Auth, Emails, Campaigns, Senders, Slack, Health
│   │   │   ├── integrations/    # SMTP, Google OAuth, Slack OAuth, Elasticsearch
│   │   │   ├── middleware/      # Auth, Zod validation, centralized error handler
│   │   │   ├── queues/          # BullMQ queues & Bull Board router
│   │   │   ├── routes/          # Express REST routers
│   │   │   ├── services/        # Scheduler, Sender, Outbox recovery, Lua Rate Limiter
│   │   │   ├── types/           # Express Request augmentation
│   │   │   ├── utils/           # AES-256-GCM crypto, errors, response helpers
│   │   │   ├── workers/         # Job processor & standalone worker entrypoint
│   │   │   ├── app.ts
│   │   │   └── server.ts
│   │   ├── tests/               # Vitest + Supertest + 1000-job load simulation
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── frontend/
│       ├── src/
│       │   ├── components/      # Compose modal, status badges, pagination, skeletons
│       │   ├── contexts/        # AuthContext
│       │   ├── layouts/         # Responsive SaaS DashboardLayout
│       │   ├── pages/           # Login, Scheduled, Sent, Search, Settings
│       │   ├── services/        # Axios API client
│       │   ├── types/           # Shared frontend TypeScript types
│       │   ├── utils/           # RFC-4180 CSV/TXT parser + tests
│       │   ├── App.tsx
│       │   └── main.tsx
│       ├── Dockerfile
│       ├── nginx.conf
│       ├── package.json
│       └── tsconfig.json
├── docker-compose.yml
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

## Prerequisites

- **Node.js** `>= 20.0.0` (tested on v22.18.0) and **npm** `>= 10`
- **Docker** and **Docker Compose** (recommended for running PostgreSQL, Redis, Elasticsearch, or full stack)
- Google Cloud OAuth 2.0 credentials
- Slack App OAuth 2.0 credentials (for live Slack notifications)
- Ethereal Email account (or auto-generate one directly from the Settings page)

---

## Quick Start with Docker Compose

1. **Copy the environment template and fill in OAuth secrets:**
   ```bash
   cp .env.example .env
   ```
   Update `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SESSION_SECRET`, and `ENCRYPTION_KEY` in `.env`.

2. **Start all services (PostgreSQL, Redis, Elasticsearch, Backend API, BullMQ Worker, Frontend):**
   ```bash
   docker compose up --build -d
   ```

3. **Verify service health:**
   ```bash
   curl http://localhost:4000/api/health
   ```

4. **Open the application:**
   - Frontend Dashboard: `http://localhost:5173`
   - Backend API: `http://localhost:4000`
   - Bull Board (authenticated): `http://localhost:4000/admin/queues`

---

## Local Development Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start infrastructure containers (PostgreSQL, Redis, Elasticsearch):**
   ```bash
   docker compose up -d postgres redis elasticsearch
   ```

3. **Configure `.env`:**
   ```bash
   cp .env.example .env
   ```

4. **Generate Prisma client & run database migrations:**
   ```bash
   npm run prisma:generate
   npm --workspace=@reachinbox/backend run prisma:deploy
   ```
   *(For creating new migrations in development, run `npm run prisma:migrate`.)*

5. **Run Backend API, Worker, and Frontend concurrently:**
   ```bash
   npm run dev
   ```
   Or start each process in separate terminals:
   ```bash
   npm run dev:api      # API server on http://localhost:4000
   npm run dev:worker   # BullMQ worker process
   npm run dev:web      # Vite frontend on http://localhost:5173
   ```

---

## OAuth & SMTP Setup Guides

### 1. Google OAuth 2.0 Setup
1. Open [Google Cloud Console -> APIs & Services -> Credentials](https://console.cloud.google.com/apis/credentials).
2. Create an **OAuth 2.0 Client ID** (Web application).
3. Add **Authorized JavaScript origins**: `http://localhost:5173`, `http://localhost:4000`.
4. Add **Authorized redirect URI**: `http://localhost:4000/api/auth/google/callback`.
5. Copy Client ID and Client Secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`.

### 2. Slack OAuth 2.0 Setup
1. Open [Slack API Apps](https://api.slack.com/apps) and click **Create New App -> From scratch**.
2. Go to **OAuth & Permissions** and add Redirect URL: `http://localhost:4000/api/slack/callback`.
3. Under **Bot Token Scopes**, add:
   - `incoming-webhook`
   - `chat:write`
4. Copy **Client ID** and **Client Secret** (from *Basic Information*) into `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` in `.env`.
5. Note: In the ReachInbox Dashboard -> **Settings**, clicking **Connect Slack** lets the user pick any target channel during Slack's consent screen.

### 3. Ethereal Email SMTP Setup
- **Option A (Instant 1-Click in Dashboard):** After logging in, go to **Settings** and click **Auto-Generate Ethereal Sender**. The backend calls `nodemailer.createTestAccount()`, encrypts the password with AES-256-GCM, and saves the sender in PostgreSQL.
- **Option B (Manual):** Visit [https://ethereal.email/create](https://ethereal.email/create), copy the SMTP host (`smtp.ethereal.email`), port (`587`), username, and password, and add them via **Settings -> Add Sender** or in `.env`.

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `NODE_ENV` | Runtime environment (`development` \| `test` \| `production`) | `development` |
| `PORT` | Express API port | `4000` |
| `FRONTEND_URL` | Allowed CORS origin & OAuth redirect target | `http://localhost:5173` |
| `BACKEND_URL` | Backend base URL | `http://localhost:4000` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://reachinbox:...` |
| `REDIS_HOST` | Redis hostname | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `REDIS_PASSWORD` | Redis password (optional) | `""` |
| `ELASTICSEARCH_URL` | Elasticsearch HTTP endpoint | `http://localhost:9200` |
| `ELASTICSEARCH_INDEX` | Elasticsearch email index name | `reachinbox_emails` |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID | — |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret | — |
| `GOOGLE_CALLBACK_URL` | Google OAuth callback URL | `http://localhost:4000/api/auth/google/callback` |
| `SLACK_CLIENT_ID` | Slack OAuth Client ID | — |
| `SLACK_CLIENT_SECRET` | Slack OAuth Client Secret | — |
| `SLACK_REDIRECT_URI` | Slack OAuth callback URL | `http://localhost:4000/api/slack/callback` |
| `SESSION_SECRET` | JWT session signing secret | — |
| `ENCRYPTION_KEY` | 64-char hex key for AES-256-GCM secret encryption | — |
| `ETHEREAL_HOST` | Default Ethereal SMTP host | `smtp.ethereal.email` |
| `ETHEREAL_PORT` | Default Ethereal SMTP port | `587` |
| `ETHEREAL_USER` | Default Ethereal username (optional) | — |
| `ETHEREAL_PASS` | Default Ethereal password (optional) | — |
| `WORKER_CONCURRENCY` | Concurrent jobs per BullMQ worker instance | `5` |
| `MAX_RETRY_ATTEMPTS` | Max SMTP retry attempts per email | `3` |
| `RETRY_DELAY` | Base exponential backoff delay (ms) | `5000` |
| `DEFAULT_EMAIL_DELAY` | Default delay between campaign emails (ms) | `2000` |
| `MIN_EMAIL_DELAY_MS` | Minimum enforced delay between sends per sender (ms) | `2000` |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | Global ceiling per sender per UTC hour | `100` |

---

## API Documentation

### Authentication
- `GET /api/auth/google` — Redirects to Google OAuth 2.0 with CSRF state cookie
- `GET /api/auth/google/callback` — Exchanges code, upserts `User`, sets HTTP-only JWT cookie
- `GET /api/auth/me` — Returns current authenticated user
- `POST /api/auth/logout` — Clears session cookie

### Email Scheduling & Search
- `POST /api/emails/schedule` — Validates & schedules campaign transactionally (`Idempotency-Key` safe)
- `GET /api/emails/scheduled` — Paginated list (`page`, `limit`, `status`, `search`)
- `GET /api/emails/sent` — Paginated sent/failed list (`page`, `limit`, `status`, `search`, `from`, `to`)
- `GET /api/emails/search` — Full-text search (`q`, `status`, `from`, `to`, `page`, `limit`) via Elasticsearch
- `GET /api/emails/stats` — Summary counts (`total`, `sent`, `failed`, `pending`, `cancelled`)
- `GET /api/emails/:id` — Single email detail (owner-scoped)
- `POST /api/emails/:id/cancel` — Cancels a `scheduled` email and removes its BullMQ delayed job

### Campaigns & Senders
- `GET /api/campaigns` — List user's campaigns
- `GET /api/campaigns/:id` — Campaign detail
- `GET /api/campaigns/:id/stats` — Campaign status breakdown
- `GET /api/senders` — List configured senders (passwords excluded)
- `POST /api/senders` — Create encrypted SMTP sender
- `POST /api/senders/ethereal` — Auto-provision a real Ethereal test account
- `POST /api/senders/:id/verify` — Verify live SMTP connectivity
- `PUT /api/senders/:id` — Update sender settings
- `DELETE /api/senders/:id` — Delete or soft-deactivate sender

### Slack & Health
- `GET /api/slack/connect` — Starts Slack OAuth 2.0 with Redis state validation
- `GET /api/slack/callback` — Stores encrypted Slack token & webhook URL
- `GET /api/slack/status` — Returns Slack connection status
- `POST /api/slack/disconnect` — Disconnects Slack integration
- `GET /api/health` — Checks PostgreSQL, Redis, and Elasticsearch health
- `GET /api/health/config` — Returns non-secret worker/rate-limiter runtime settings

---

## Bull Board Queue Dashboard

- **URL:** `http://localhost:4000/admin/queues`
- **Authentication:** Protected by `requireBullBoardAuth` (requires valid HTTP-only session cookie from Google login). Unauthenticated browsers are redirected to `/login`.
- Displays Waiting, Active, Delayed, Completed, and Failed jobs for both `email-send-queue` and `elasticsearch-index-queue`.

---

## Distributed Rate Limiting Algorithm & Trade-Offs

### Chosen Defaults
- `WORKER_CONCURRENCY=5`
- `MIN_EMAIL_DELAY_MS=2000` (2 seconds minimum spacing per sender across all workers)
- `MAX_EMAILS_PER_HOUR_PER_SENDER=100` (max 100 emails per sender per hour window)

### How It Works (`apps/backend/src/services/rateLimiterService.ts`)
A single **atomic Redis Lua script** (`RESERVE_SLOT_LUA`) runs before any SMTP send:
1. **Hourly Window Check:** Computes `hourBucket = Math.floor(nowMs / 3600000)` and reads `rl:sender:{senderId}:hour:{hourBucket}`.
2. **Hourly Exhaustion & Future Window Staggering:** If `currentCount >= effectiveHourlyLimit`, the script scans future hours `h = hourBucket + 1 ...` and atomically increments `rl:sender:{senderId}:reserved:{h}` to assign a staggered timestamp `targetMs = h * 3600000 + slotIdx * stepMs`.
   - The worker updates `ScheduledEmail.scheduledAt` in PostgreSQL, fires a Slack notification (once per window), and calls BullMQ's `job.moveToDelayed(targetMs, token)` + `throw new DelayedError()`, which reschedules without consuming retry attempts or failing the job.
3. **Minimum Inter-Email Delay:** If hourly capacity remains but `nowMs < nextSlot`, a `delay_cursor` key staggers concurrent workers by `effectiveMinDelay` so jobs do not thundering-herd onto the same millisecond.
4. **Atomic Reservation & Failure Release:** When `ALLOWED`, the Lua script atomically increments the hourly counter and advances `next_slot`. If Nodemailer SMTP subsequently throws an error, the worker calls `releaseHourlySlot` (Lua `DECR` clamped at `0`) so **failed SMTP attempts never count against the hourly quota**.

### Trade-Offs
- **Fixed UTC hour buckets vs. sliding window:** Fixed hour buckets (`Math.floor(nowMs / 3600000)`) are O(1) in Redis, simple to reason about for "next available hour window" rescheduling, and cheap to expire (`EXPIRE 7200`). The trade-off is boundary bursting (e.g., 100 emails at 10:59 and 100 at 11:00), which is further smoothed by `MIN_EMAIL_DELAY_MS`.
- **Reserving before SMTP vs. incrementing after SMTP:** Reserving before SMTP prevents concurrent workers from overshooting the hourly limit while requests are in flight; releasing on SMTP error preserves quota accuracy.

---

## Persistence, Restart Recovery & Idempotency

1. **Docker Volumes & Redis AOF:** PostgreSQL (`postgres_data`), Redis (`redis_data` with `--appendonly yes --appendfsync everysec`), and Elasticsearch (`elasticsearch_data`) persist across container restarts.
2. **Transactional Outbox (`OutboxEvent`):** `POST /api/emails/schedule` inserts `EmailCampaign`, `ScheduledEmail[]`, and `OutboxEvent[]` in a single ACID PostgreSQL transaction before publishing to BullMQ.
3. **Deterministic Job IDs & Deduplication:** Each BullMQ job uses `jobId = scheduledEmail.id`. Duplicate API submissions match `EmailCampaign(userId, idempotencyKey)` and return HTTP 200 (`duplicate: true`) without duplicate DB rows or queue jobs.
4. **Startup Reconciliation (`reconcileDatabaseAndQueuesOnStartup`):**
   - Flushes any unpublished `pending` outbox events.
   - Reclaims stale `processing` emails (>2 min old with no active Redis lock).
   - Enqueues BullMQ jobs only for `scheduled` rows missing from Redis.
   - **Never** re-enqueues `sent` or `cancelled` emails.
5. **Unavoidable SMTP Delivery Ambiguity:** Because SMTP does not support two-phase commit (2PC), a process crash *immediately after* the remote SMTP server accepts `DATA` and *before* PostgreSQL commits `status = 'sent'` leaves an inherent at-least-once edge case. ReachInbox minimizes this window by:
   - Acquiring a per-email Redis mutex (`lock:email:{id}`) and transitioning `scheduled -> processing` prior to SMTP.
   - Attaching an `X-Idempotency-Key` header to every outgoing SMTP message.
   - Committing `sent`, `sentAt`, and `smtpMessageId` atomically right after `sendMail` resolves.

---

## Elasticsearch Indexing & Fallback

- Email documents (`emailId`, `userId`, `campaignId`, `senderEmail`, `recipientEmail`, `subject`, `body`, `status`, `scheduledAt`, `sentAt`, `createdAt`) are indexed asynchronously via `OutboxEvent` + `elasticsearch-index-queue`.
- `GET /api/emails/search` always enforces `term: { userId }` so users can only search their own data.
- If Elasticsearch is temporarily unreachable, `OutboxEvent` retries with exponential backoff, scheduling/sending continue uninterrupted, and `GET /api/emails/search` falls back transparently to PostgreSQL (`engine: "postgres-fallback"`).

---

## Slack Rate-Limit Notifications

- When a sender reaches its hourly limit, the worker reads the user's `SlackIntegration` from PostgreSQL (meaning connecting Slack later works immediately without restarting workers).
- If connected, it acquires a Redis idempotency key `slack:ratelimit:notified:{senderId}:{hourBucket}` (`NX EX 7200`) and posts the sender email, hourly limit, window count, campaign ID, timestamp, and rescheduled window time to the connected Slack channel.
- If Slack is not connected or temporarily unreachable, scheduling and rescheduling proceed normally without failing jobs.

---

## Automated Testing

Run all backend and frontend unit/integration/load tests:

```bash
npm test
```

What is covered:
- **Backend (`apps/backend/tests/`):**
  - Google OAuth flow, CSRF state verification, HTTP-only JWT cookies, logout, and Bull Board auth protection (`auth.test.ts`)
  - Request validation, transactional scheduling, recipient deduplication, duplicate campaign prevention, owner authorization, and sent-email cancellation rejection (`scheduling.test.ts`)
  - Worker SMTP delivery, Ethereal preview URL capture, idempotent skip on re-run, SMTP failure quota release & retry transition, hourly limit rescheduling + Slack idempotent alert, **1,000-email concurrent load simulation**, and restart outbox/stale recovery (`workerAndRateLimiter.test.ts`)
  - Elasticsearch user-scoped search, PostgreSQL fallback when ES is down, and Slack OAuth connect/status/disconnect (`elasticsearchAndSlack.test.ts`)
- **Frontend (`apps/frontend/src/utils/__tests__/`):**
  - CSV/TXT parsing, header detection, duplicate elimination, and invalid email reporting (`csvParser.test.ts`)

---

## 5-Minute Demo Script

1. **Start services:** `docker compose up -d` (or `npm run dev` with `postgres`, `redis`, `elasticsearch` running).
2. **Login:** Visit `http://localhost:5173`, click **Continue with Google**, and land on the dashboard.
3. **Configure Sender:** Go to **Settings -> Auto-Generate Ethereal Sender** (creates and encrypts a live Ethereal SMTP account in 1 click).
4. **Connect Slack:** Click **Connect Slack** in **Settings**, authorize a test workspace/channel, and verify status shows **Connected**.
5. **Schedule Campaign:** Click **Compose New Email**, upload a `.csv`/`.txt` with ~10 recipients (including 1 duplicate and 1 invalid address to show parser counts), set `delayBetweenEmails = 2000`, `hourlyLimit = 4`, and submit.
6. **Inspect Scheduled & Live Queues:**
   - View upcoming jobs in **Scheduled Emails**.
   - Open **Bull Board Queues** (`/admin/queues`) to inspect delayed/active/completed jobs live.
7. **Observe Ethereal Delivery & Rate Limit + Slack Alert:**
   - First 4 emails deliver via Ethereal SMTP; open **Sent Emails** and click **Preview** to inspect the rendered Ethereal email.
   - Email #5 hits `hourlyLimit = 4`: check Slack for the real-time **"Email Rate Limit Reached"** notification and confirm emails #5–#10 are rescheduled into the next hour window in **Scheduled Emails**.
8. **Verify Restart Persistence:** Stop and restart the worker (`Ctrl+C` then `npm run dev:worker`). Confirm pending future emails remain intact and already-sent emails are never duplicated.

---

## Troubleshooting

- **`GOOGLE_OAUTH_NOT_CONFIGURED` / `SLACK_OAUTH_NOT_CONFIGURED`:** Ensure client IDs and secrets are set in `.env` and restart the API process.
- **Docker PostgreSQL/Redis connection refused:** Check `docker compose ps` and confirm health checks pass (`docker compose logs postgres redis`).
- **Elasticsearch red/yellow or slow startup:** Give Elasticsearch ~20–30 seconds on initial boot; verify `http://localhost:9200/_cluster/health`. Search automatically falls back to PostgreSQL until ES is ready.
- **Prisma generate fails behind proxy/offline:** Ensure network access on initial `prisma generate` so the query engine binary is cached in `node_modules/.prisma`.
