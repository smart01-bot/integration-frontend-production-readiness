# Tour de Rotary DSM 2026 — Backend

Backend API for **Tour de Rotary Dar es Salaam 2026** — *"The city moves. The memory remains."*

This is not a conventional race-registration API. Registration and ticketing are the base; the larger goal is a **temporary digital community around a physical event**. The backend therefore implements the full product journey:

```
Discover → Join → Connect → Participate → Experience → Remember
```

Built on **Node.js / Express 5** with **Supabase (PostgreSQL 16 + Auth + Storage)** as the data layer, **PayMe Africa** for mobile-money payments, and **Textify / Resend** for SMS/email.

**Current state:** 29 route modules · **147 endpoints** · 31 controllers · 3 background workers · migration ledger + runner · 22 contract tests (all passing) · all 30 audit findings closed.

---

## Contents

1. [Tools & languages](#tools--languages)
2. [Quick start](#quick-start)
3. [Architecture](#architecture)
4. [File structure — what each file does](#file-structure--what-each-file-does)
5. [Important code, explained](#important-code-explained)
6. [How the backend achieves each product goal](#how-the-backend-achieves-each-product-goal)
7. [API reference](#api-reference)
8. [Background workers](#background-workers)
9. [Security model](#security-model)
10. [Database & migrations](#database--migrations)
11. [Testing & verification](#testing--verification)
12. [Known limitations](#known-limitations)

---

## Tools & languages

| Layer | Tool | Why |
|---|---|---|
| Language | **JavaScript (Node.js 18+, ESM)** | `"type": "module"` — every file uses `import`/`export` |
| HTTP framework | **Express 5** | Routing, middleware chain |
| Database | **Supabase (PostgreSQL 16)** | Data + Row-Level Security + Auth + Storage |
| DB client | `@supabase/supabase-js` | Service-role client server-side |
| Auth | **Supabase Auth** (JWT sessions) | Backend verifies tokens; never signs its own |
| Payments | **PayMe Africa** (mobile money) | Initiate + signed webhook |
| SMS / Email | **Textify Africa** / **Resend** | Queue-dispatched, templated |
| Security | `helmet`, `cors`, `express-rate-limit`, `express-validator` | Headers, origin allow-list, rate tiers, input validation |
| Logging | `winston` + `morgan` | Structured JSON logs to file, per-level routing |
| Testing | **Jest** + `supertest` | HTTP contract tests |
| CI | **GitHub Actions** (`.github/workflows/ci.yml`) | Boots server, runs contract suite |
| Migrations | Custom runner (`scripts/migrate.js`) | Ledger-tracked, ordered SQL application |

Unused-but-installed: `bcrypt`, `jsonwebtoken`, `pg`, `pg-promise`, `redis`, `socket.io` (see [Known limitations](#known-limitations)).

---

## Quick start

```bash
npm install
cp .env.example .env      # fill in Supabase keys; others optional for dev
npm run dev               # nodemon, or: node index.js
npm run migrate:status    # see which SQL migrations are applied
```

- Server: `http://localhost:8800`
- Health: `GET /api/v1/health` — really pings the database; returns **503** when the DB is down
- Contract tests: `BASE_URL=http://localhost:8800 npx jest tests/contract.test.js`

### Key environment variables

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | **yes** (fails fast without them) | Service-role DB access — bypasses RLS |
| `SUPABASE_ANON_KEY` | yes | Verifying participant-issued tokens |
| `ALLOWED_ORIGINS` | prod | Comma-separated CORS allow-list |
| `PAYME_API_KEY` / `PAYME_MERCHANT_CODE` / `PAYME_API_URL` / `PAYME_WEBHOOK_SECRET` | for payments | Webhook signatures are **mandatory** once the secret is set |
| `TEXTIFY_API_KEY`, `RESEND_API_KEY` | for SMS/email | Queue drains but marks items failed without them |
| `PORT` | no | Default `8800` |

---

## Architecture

```
Client (Next.js frontend, mobile)
        │  HTTPS + JSON, Bearer token or httpOnly cookie
        ▼
Express app (index.js, port 8800)
        │  morgan→winston request log
        │  helmet, CORS allow-list, body-parser (10mb), cookie-parser
        │  apiHygiene: pagination clamps + rate-limit tiers
        ▼
Routes (29 modules)  ──  auth() verifies Supabase token → req.user
        │                    rbac() checks profiles.role (server-resolved)
        ▼
Controllers (31)  ──  supabase-js queries (service-role key)
        │
        ├──▶ PostgreSQL (Supabase) — RLS is defense-in-depth, not primary gate
        ├──▶ PayMe Africa API  ◀── signed webhook back to /payments/payme/webhook
        ├──▶ Textify (SMS) / Resend (email) — via communication_queue
        └──▶ Supabase Storage — race photos

Background workers (every 60s/10min, intervals tracked for graceful shutdown):
  inventoryReservationWorker · communicationDispatchWorker · phaseEngine
```

---

## File structure — what each file does

### Root

| File | Purpose |
|---|---|
| `index.js` | The whole server wiring: middleware order, CORS policy, health check, mounting of all 29 route groups, 3 background workers, graceful shutdown. ~230 lines, heavily commented with the audit finding each section addresses. |
| `package.json` | Scripts: `dev`, `start`, `test` (jest), `migrate`, `migrate:status`. |
| `verify_checklist.mjs` | End-to-end verification script — 11 sections exercised against a live server (auth, registration→order→ticket, webhook security, community, teams, challenges, phase behaviour, etc.). |
| `test_new_features.mjs` | Older feature probe script (community APIs, admin endpoints). |
| `.env.example` | Template of every supported variable. |

### `config/`

| File | Purpose |
|---|---|
| `supabase.js` | Creates the **service-role** Supabase client. The single database surface for the whole app. |
| `database.js` | Legacy pg-promise pool (superseded by Supabase; retained for local scripts). |
| `redis.js` | Dead code — attempts a live connection at import but nothing imports it. |

### `middleware/`

| File | Purpose |
|---|---|
| `auth.js` | **Authentication.** Verifies the Supabase access token with Supabase Auth itself, then resolves the caller's role from the `profiles` table — never from a client header. Attaches `req.user`. Accepts `Authorization: Bearer` or httpOnly `accessToken` cookie. Maps frontend's `hq_admin` → backend's `admin`. |
| `rbac.js` | **Authorization.** `requireRole([...])` trusts *only* `req.user`. `admin`/`hq_admin` are implicit superusers. A missing `req.user` is 401 (auth never ran), a wrong role is 403. |
| `apiHygiene.js` | `clampPagination` (caps `?limit=100`, sane `?page=` defaults on `req.pagination`) plus named rate-limit tiers: tight on public social writes and the PayMe webhook, generous on reads. |
| `validator.js` | Runs `express-validator` results; returns 400 with the error array. |
| `errorHandler.js` | Global error handler — maps thrown `error.status` to HTTP status, logs, returns JSON. |

### `controllers/` (31 — one per domain)

| Controller | Domain |
|---|---|
| `activityController.js` | Race activities catalogue (6 activities: swim, bike, run, walk, dance, corporate relay) |
| `cartController.js` | Guest checkout: cart → profile+order creation without prior login |
| `merchandiseController.js` | Merch catalogue + variants + stock |
| `paymentController.js` | PayMe initiate, **signed webhook**, amount cross-check, idempotency, status/verify/retry; mints tickets and auto-issues digital bibs on success |
| `ticketController.js` | Ticket issuance, QR tokens, check-in |
| `participantController.js` | One aggregated profile call (tickets, orders, bib, team, challenges+badges, result, wishlist, pickup confirmation, referrals) |
| `adminController.js` | HQ: dashboard, users, orders, inventory, promo codes, capacity, refunds, audit log, CSV exports (registrations/revenue), phase override |
| `communityController.js` | Feed: posts (single or multi-image), reactions, comments, report/moderation |
| `teamController.js` | Teams + relay logic; captain-only edit |
| `challengeController.js` | Challenges: list/join/complete/leaderboard/CRUD, Dar-timezone date windows |
| `resultsController.js` | Results ingestion (JSON batch + **CSV import** with header aliases/time parsing/dedupe), 6 leaderboards (overall, swim, bike, run, community, participation) |
| `bibController.js` | Digital bibs; `GET /bibs/me` lazy-issues on first view |
| `photoController.js` | Race photos to Supabase Storage; single + batch upload; "Find Me" bib search |
| `storyController` coverage via `communityController.js` + `routes/storiesRoutes.js` | Stories surfaces |
| `whyIParticipateController.js` | "Why I Participate" submit → admin approve → public list |
| `consentController.js` | Research consent: grant/read/withdraw + admin aggregate summary |
| `researchController.js` | Research program config |
| `triathlonController.js` | Course stages, race categories, map waypoints (Dar Map) |
| `socialController.js` | Twibbon-style SVG name badges, OG card lookup |
| `collectibleController.js` | Tiered digital collectibles: issue, list, **public hash verification**, my-certificate |
| `communicationController.js` | Templates, queue monitoring, test-send, logs |
| `commsController.js` | Direct SMS/email send (staff) |
| `campaignController.js` | Landing pages + campaign tracking |
| `contentController.js` / `eventContentController.js` | Phase-aware CMS content blocks |
| `evaluationController.js` | Post-event surveys, impact report |
| `volunteerController.js` | Shifts, zones, briefing ack, check-in |
| `sponsorController.js` / `partnerController.js` | Sponsor/partner portals + assets/deliverables |
| `newsletterController.js` | Subscribe |
| `fitnessController.js` | Strava sync — **honest 501 placeholder** (pending third-party approval) |
| `incidentController.js` | Race-day incident reports |

### `routes/` (29 — thin, declarative)

Each file maps `HTTP method + path → [middleware chain, controller]`. The middleware order **is** the security policy, e.g.:

```js
router.get('/leaderboard', readLimiter, getLeaderboard);                    // public
router.post('/', auth(), requireRole(['admin','volunteer']), importCsv);    // staff
```

Groups: `activity, admin, bib, campaign, cart, challenge, collectible, comms, communication, community, consent, content, evaluation, fitness, merchandise, newsletter, participant, partner, payment, photo, research, results, social, sponsor, stories, team, ticket, triathlon, volunteer`.

### `services/`

| File | Purpose |
|---|---|
| `phaseEngineService.js` | Derives `pre_event → event_day → post_event → archive` from `event_date` and persists to `event_editions`/`event_config`/`event_lifecycle` (recursion-guarded). Clears stale `archive_date`/`memory_mode_unlocked_at` when back in live mode. Archive window configurable via `config_json.archive_after_days` (default 30). |
| `inventoryReservationWorker.js` | Auto-releases merch reservations after the 7-day hold. |
| `communicationDispatchWorker.js` | Drains due items from `communication_queue` → Textify/Resend. |
| `paymeService.js` | PayMe API client (initiate payment). |
| `textifySmsService.js` / `resendEmailService.js` | Vendor clients; report `NOT_CONFIGURED` on placeholder keys. |
| `loggingService.js` | Winston loggers + `morganMiddleware` — every request logged as JSON to `logs/combined.log`; status ≥ 400 also to `logs/error.log` at warn/error level. |
| `queueService.js` | **Dead code** — references a non-existent `models/` dir. Never imported. |

### `utils/`

| File | Purpose |
|---|---|
| `darTime.js` | `darToday()` / `darDateOffset()` — Dar-es-Salaam (EAT) calendar dates via `Intl`. Every date-window comparison uses these; UTC-based `toISOString().slice(0,10)` was a real bug (challenges expired at 9pm local). |
| `constants.js` | Shared enums/limits. |
| `helpers.js` | Misc formatting/parsing helpers. |

### `migrations/`

| File | Purpose |
|---|---|
| `000_ledger.sql` | **Manual one-time bootstrap**: `schema_migrations` ledger + `exec_sql` RPC locked to service role. After this, the runner handles everything. |
| `001_schema.sql` | Core tables (profiles, orders, registrations, tickets, payments, merch, …). |
| `002_triggers_rls.sql` | Triggers (registration→order, sponsor/partner sync) + Row-Level Security policies. |
| `003_seed.sql` | Activities, categories, course stages, waypoints (stages/waypoints flagged `is_confirmed = false` until verified against the real course). |
| `018_audit_fixes.sql` | Multi-image posts (`media_urls`), registration uniqueness, RLS lockdown on bibs/challenges/results/consent, stale lifecycle cleanup. Idempotent. |
| `legacy/` | Archived pre-ledger SQL kept for history. |

### `scripts/`, `tests/`, `docs/`

| File | Purpose |
|---|---|
| `scripts/migrate.js` | Ledger-tracked migration runner. Applies pending `migrations/*.sql` in filename order via the `exec_sql` RPC and records each. `--status` reports applied vs pending. Never re-runs an applied file. |
| `tests/contract.test.js` | 22 HTTP contract tests: status codes, auth gates, pagination clamps, webhook signature/amount/idempotency. Safe against any seeded dev environment. |
| `docs/FRONTEND_BACKEND_INTEGRATION.md` | Contract notes for the frontend team. |

---

## Important code, explained

**Health check that can actually fail** (`index.js`) — used to return a static "healthy" while the DB was down:

```js
const { error } = await supabase
  .from('event_config')
  .select('id', { count: 'exact', head: true });   // cheapest possible DB probe
if (error) throw error;
dbLatencyMs = Date.now() - healthStart;
// ...
res.status(dbStatus === 'up' ? 200 : 503).json({ status: overall, checks: { database: { status: dbStatus, latency_ms: dbLatencyMs } } });
```
A head-count against a known table exercises auth + REST + Postgres in one round trip, and reports real latency. 503 lets monitoring page on a real outage.

**Authentication never trusts the client** (`middleware/auth.js`):

```js
const { data: authData, error: authError } = await supabase.auth.getUser(token);  // verify with Supabase itself
// ...
role: profile.role === 'hq_admin' ? 'admin' : profile.role   // role resolved from OUR table
```
The role comes from the `profiles` table after the token is independently verified. An `x-user-role` header is accepted for compatibility but never consulted for authorization — `rbac.js` reads only `req.user`, which only `auth()` can set.

**PayMe webhook: signature + amount + idempotency** (`controllers/paymentController.js`):

```js
const signature = req.headers['x-payme-signature'];   // mandatory when PAYME_WEBHOOK_SECRET is set
// cross-check reported amount vs the order's true total_tsh before recording payment
if (amountTsh && !regOrder.total_tsh) { /* reconcile */ }
// replayed webhooks are detected and answered without re-processing (duplicate_prevented)
```
On success the same handler mints tickets **and** auto-issues digital bibs (`autoIssueBibForUser`) — fail-soft, so a bib hiccup can never block a payment confirmation.

**Timezone-correct calendar days** (`utils/darTime.js`):

```js
export const DAR_TZ = 'Africa/Dar_es_Salaam';
const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: DAR_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export function darToday() { return dateFmt.format(new Date()); }
```
UTC "today" resolved to the wrong day between 21:00–24:00 UTC (midnight–3am in Dar), silently closing challenge windows three hours early. All four challenge date comparisons now use Dar days.

**Unbounded-list protection** (`middleware/apiHygiene.js`):

```js
const MAX_LIMIT = 100;   // req.pagination = { page, limit, offset } — ALWAYS defined
```
No list endpoint can be driven into a full-table scan with `?limit=999999`, and out-of-range pages normalize instead of 500ing (PostgREST rejects offsets past the last row).

**Graceful shutdown** (`index.js`):

```js
workerIntervals.forEach(clearInterval);   // no worker cycle killed mid-job
server.close(async () => { /* drain in-flight requests */ process.exit(0); });
setTimeout(() => process.exit(1), 10_000).unref();   // don't hang forever
process.on('SIGTERM', () => shutdown('SIGTERM'));
```
Idempotent handlers (double Ctrl+C won't double-run), 10s force-exit budget, workers stopped before the server closes.

**Phase engine** (`services/phaseEngineService.js`) — the platform switches experience automatically as the schedule passes: `pre_event → event_day` (24h from flag-off, configurable) `→ post_event → archive` (default 30 days, `config_json.archive_after_days`). The engine also repairs contradictory lifecycle metadata (e.g. clearing a stale `archive_date` once the edition is live again), which had produced a memory banner on a pre-event homepage.

---

## How the backend achieves each product goal

Mapped to the Tour de Dar journey and Schedule A:

| Goal / Journey stage | Backend capability |
|---|---|
| **Discover** (A1) | Phase-aware CMS content, campaigns/landing pages, countdown data via phase engine; homepage experience switches pre/event/post/archive automatically |
| **Join** (A2, A7, Priority 1) | Activity registration → auto-created order (DB trigger) → PayMe checkout → **signed webhook** → payment record → ticket with QR → **digital bib auto-issued**; guest checkout supported; retry flow; promo codes; capacity/early-bird controls |
| **Connect** (§community) | Teams with relay logic (captain-only admin), community feed (multi-image posts, reactions, comments), "Why I Participate" (submit → approve → public) |
| **Participate** (A2) | Challenges with badges and Dar-correct windows, 6 leaderboards, aggregated participant profile in one call, training area (Strava scaffolded, honest 501) |
| **Experience** (A1, race day) | Course stages + Dar Map waypoints, race photos with **Find-Me bib search**, volunteer shifts/briefings/check-in, HQ results CSV import, incident reporting, comms broadcasting |
| **Remember** (§17 "the memory remains", A8) | Archive phase auto-derived 30 days post-event (reads stay open, new social writes blocked), tiered digital collectibles with **public QR/hash verification**, stories, certificates (hash-mode; PDF pending), shareable name badges |
| **HQ control** (A6) | Users/orders/inventory/promo/refund management, audit trail (staff-only reads), CSV exports, comms queue monitoring, phase override, role-based access |
| **Comms** (A9) | `communication_queue` + dispatch worker → Textify SMS / Resend email, templates, scheduled delivery, newsletter |

---

## API reference

All routes under `/api/v1`. **Auth** = valid Supabase session (`auth()`); **Role** = `requireRole([...])`.

### Public
| Base path | Endpoints | Purpose |
|---|---|---|
| `/activities` | 2 | Activity catalogue |
| `/merchandise` | 2 | Merch catalogue |
| `/content` | 1 | Phase-aware content blocks |
| `/campaigns` | 3 | Landing pages, tracking |
| `/newsletter` | 1 | Subscribe |
| `/cart` | 1 | `POST /checkout` — guest checkout |
| `/results` | `/`, `/leaderboard` (6 boards), `/me`* | Results + leaderboards |
| `/photos` | `/`, `/bib/:bib_number` | Race photos, Find-Me search |
| `/bibs` | `/:identifier` | Public bib page |
| `/triathlon` | 10 | Stages, categories, waypoints |
| `/community` | 10 | Feed reads; writes rate-limited |
| `/collectibles` | `/verify/:hash` | Public certificate verification |
| `/health` | 1 | Real DB health check |

### Authenticated (participant)
| Base path | Highlights |
|---|---|
| `/participant` (15) | Aggregated profile, orders, wishlist (variant-validated), pickup confirmation, referrals, certificates |
| `/tickets` (3) | My tickets, QR, check-in |
| `/bibs` `/me` | Auto-issues your digital bib on first view |
| `/community` writes | Post/react/comment/report (rate-limited; author-or-staff delete) |
| `/teams` (8) | Create/join/leave/edit (captain-only edit) |
| `/challenges` (8) | List/join/complete/leaderboard |
| `/consent` (4) | Grant/read/withdraw own consent |
| `/stories` (3) | Story surfaces |
| `/research` (3) | Research program |

### Role-gated (staff)
| Base path | Roles | Purpose |
|---|---|---|
| `/admin` (23) | `admin` | Dashboard, users, orders, inventory, promo codes, capacities, refunds, incidents, audit log, **CSV exports**, phase override |
| `/results` staff | admin/volunteer | JSON batch + CSV ingest, update/delete |
| `/photos` staff | admin/volunteer | Single/batch upload |
| `/challenges` staff | admin | CRUD + end-now |
| `/triathlon` admin | admin | Waypoint/category CRUD |
| `/communications` (4) | admin | Templates, preview, test-send, logs |
| `/comms` (2) | admin | Direct SMS/email |
| `/volunteer` (3) | volunteer+ | Shifts, briefing, check-in |
| `/sponsor` (2) / `/partner` (2) | respective | Portals, assets |
| `/evaluation` (3) | mixed | Surveys (public submit), impact report |
| `/collectibles` staff | admin | Issue collectibles |
| `/social` (4) | mixed | Frame generate, OG cards |
| `/fitness` (2) | auth | **501 NOT_IMPLEMENTED** (deferred) |
| `/payments` (5) | guest + rate-limit | initiate, **webhook**, status, verify, retry |

*147 endpoints total across 29 groups. Guest-checkout payment routes are rate-limited rather than auth-gated by design — see [Security model](#security-model).*

---

## Background workers

| Worker | Interval | Job |
|---|---|---|
| Phase engine | 60s | Derive + persist lifecycle phase; repair stale metadata |
| Comms dispatcher | 60s | Send due queue items via Textify/Resend |
| Inventory reservations | 10 min | Release merch holds past the 7-day window |

All three register their intervals in `workerIntervals` so graceful shutdown can stop them cleanly.

---

## Security model

Understand these before extending the backend:

1. **The service-role key bypasses RLS.** All authorization must be correct in `auth()`/`rbac()`/controllers — there is no second line of defense server-side. RLS remains enabled as **defense-in-depth for direct client access** (the frontend also reads Supabase directly with the anon key): migration 018 locks down `digital_bibs` (anon denied), `user_challenges` (owner-only), results (finished/DNF only), and consent rows (owner-only). Verified live: the anon key previously returned every athlete's PII; it now returns `[]`.
2. **Roles are server-resolved.** `auth()` fetches the role from `profiles` after verifying the token with Supabase Auth. Client headers can't escalate privileges; `rbac.js` fails closed (401 without `req.user`, 403 on wrong role).
3. **PayMe webhooks are signature-verified whenever `PAYME_WEBHOOK_SECRET` is set** — set it in production. Amounts are cross-checked against the order's stored total, and replays are answered idempotently, so a replayed webhook can't double-issue tickets.
4. **Guest checkout is deliberate** — payment status/verify/retry are keyed by `order_number` (a 5-digit space), so those routes carry dedicated rate limiters instead of auth. In-memory limiter store is fine single-instance; move it to Redis if you ever scale horizontally.
5. **Fails-closed identity.** If a session has no resolvable profile, ticket endpoints return 403 rather than falling through to an unfiltered query (this used to fail *open* and leak all participants' QR tokens).
6. **Input hygiene.** `express-validator` on write routes; pagination clamps everywhere; 10mb JSON cap (batch photo upload headroom); CORS allow-list (no wildcard + credentials).
7. **Audit trail.** Staff actions land in `audit_logs` with actor/role/details; reads are staff-gated (negative case verified: non-staff token → 403).
8. **Ops visibility.** Real DB health probe (503 on failure), structured request logs with ≥400 routed to `error.log`, graceful shutdown, migration ledger — you can always answer "what code is the database actually running?"

---

## Database & migrations

```bash
npm run migrate:status   # applied vs pending
npm run migrate          # apply pending, in filename order, ledger-tracked
```

- One-time manual step (documented in `migrations/000_ledger.sql`): create the ledger + `exec_sql` RPC in the Supabase SQL editor. After that, the runner is fully automatic.
- Every migration file is idempotent (`IF EXISTS` / `IF NOT EXISTS` / guarded updates), so re-application is safe.
- The ledger exists because migrations were previously applied by hand with no tracking — which is how migration 017 sat unapplied for weeks while the backend got debugged.

---

## Testing & verification

```bash
BASE_URL=http://localhost:8800 npx jest tests/contract.test.js   # 22 contract tests
node verify_checklist.mjs                                        # 11-section E2E checklist
```

Verified live during development (see `.freebuff/run.md` for the full log): registration→order→ticket→bib chain; webhook signature/amount/idempotency negatives; community CRUD + moderation (report → admin hide → non-staff 403); teams captain-only edit; challenges; consent grant→withdraw; collectible issue→verify; CSV exports (header row even when empty); promo codes; admin endpoints; phase sync + archive write-block; rate-limit headers; pagination clamps. CI (`.github/workflows/ci.yml`) boots the server and runs the contract suite on push.

---

## Known limitations

Honest, specific, testable — not vague "in progress":

- **Fitness/Strava sync is unimplemented.** `GET /fitness/status`, `POST /fitness/strava/sync` return `501 NOT_IMPLEMENTED` — deferred pending third-party approval (Schedule A11). The one endpoint family that's upfront about not being done.
- **Collectibles are off-chain.** Serial number + local verification hash, fully working including public verification. `on_chain_*` columns are schema scaffolding; no chain SDK exists here. Polygon certificate mode falls back to hash-only without `POLYGON_RPC_URL`.
- **Certificates are hash-mode; no PDF.** No PDF library is installed. The Twibbon endpoint returns an **SVG name badge**, not a composited photo.
- **Dead code:** `services/queueService.js` (references a non-existent `models/` dir), `config/redis.js` + the `redis`/`pg`/`pg-promise`/`bcrypt`/`jsonwebtoken`/`socket.io` dependencies — installed but unused. Finish or delete.
- **External credentials are placeholders.** PayMe/Textify/Resend/Strava/Polygon all report `NOT_CONFIGURED` in `/health` until real keys land in `.env`; the code paths are built and waiting. The full payment→ticket→bib→SMS chain is unverifiable end-to-end until PayMe credentials arrive.
- **In-memory rate limiting** resets on restart and doesn't share across instances (fine for the current single-instance deploy).

Everything else described here — auth/RBAC, checkout and the full payment chain, tickets/check-in, community + moderation, teams, challenges, results ingestion and leaderboards, photos/Find-Me, digital bibs, consent, phase engine with archive, admin tooling, comms queue, audit logging — is implemented, mounted, and covered by the verification suite.
