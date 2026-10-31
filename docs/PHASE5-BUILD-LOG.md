# Phase 5 — Build Log

**Purpose**: One section per vertical slice. Each section records:
- Goal
- Files created / changed
- How to run it
- Tests added
- Exact commit message
- Status (Done / Planned)
- Any deviation from Phase 3/4

---

## Slice 1 — Skeleton & Config

**Goal**: Scaffold the entire project, validate env, set up logging, Express factory, login/logout with session + CSRF + rate‑limit, Helmet + CSP, Docker files, .gitignore, .env.example, test config, and the beginner guide.

### Files created / changed

| File | Change |
|---|---|
| `package.json` | Added scripts, deps (`express`, `express-rate-limit`, `mongoose`, `express-session`, `helmet`, `zod`, `nodemailer`, `ejs`, `node-cron`, `pino`, `pino-http`, `ipaddr.js`, `connect-mongo`, `htmx.org`), devDeps (`jest`, `supertest`, `eslint`, `nodemon`). |
| `eslint.config.js` | Lint rules for ES modules, no unused vars, consistent style. |
| `jest.config.js` | Unit + integration test config. |
| `.gitignore` | Ignores `node_modules`, `.env`, coverage, logs. |
| `.env.example` | Full template with all env vars (placeholders only). |
| `src/config/index.js` | Zod validation, **no per-target auth fields** (they belong on the Target model), login‑rate‑limit config, weak‑secret rejection, `SCOPE_CIDRS` outer boundary, `randomToken` helper. |
| `src/utils/logger.js` | pino logger + `connectMongo()` helper. |
| `src/app.js` | Express factory: Helmet (CSP), session (MongoStore), CSRF double‑submit, login rate‑limit, `/health`, `/login`, protected route scaffold, error handler. |
| `src/index.js` | Boot: `connectMongo()` → `createApp()` → `listen()`. |
| `src/middleware/auth.js` | Auth guard with constant‑time compare (`safeEqual`). |
| `src/middleware/csrf.js` | Double‑submit cookie (readable by forms, validated on mutating verbs). |
| `src/middleware/error.js` | Global error handler (logs, hides stack in prod). |
| `src/routes/auth.js` | `GET /login` (form), `POST /login` (session create), `POST /logout` (destroy). |
| `docker/docker-compose.yml` | MongoDB service (port 27017, volume). |
| `docker/Dockerfile.app` | Minimal Alpine Node 20 image, `npm ci --omit=dev` layer cache. |
| `docker-compose.yml` (root) | Same as `docker/docker-compose.yml` for convenience. |
| `tests/unit/.gitkeep`, `tests/integration/.gitkeep`, `src/models/.gitkeep`, `src/scanner/.gitkeep`, `src/scheduler/.gitkeep`, `src/services/.gitkeep`, `src/utils/.gitkeep`, `views/.gitkeep` | Placeholders so Git tracks empty dirs. |
| `docs/PROJECT-GUIDE.md` | Complete beginner guide (problem, glossary, architecture, flow, file walkthrough, run/test/demo, security decisions, 2‑min/5‑min pitches, 15 judge Q&A, status table). |
| `DECISIONS.md` | Added scope relationship note (outer boundary + per‑target intersection). |

### How to run

```bash
# 1) Copy env template and edit with real secrets
cp .env.example .env
# Ensure ADMIN_PASSWORD and SESSION_SECRET are real values (>8 / >16 chars)

# 2) Start MongoDB
docker compose up -d

# 3) Install deps and start the app
npm ci
npm start
# Server listens on http://localhost:3000

# 4) Verify endpoints
curl http://localhost:3000/health
# => {"status":"ok","time":"..."}

curl -i -c cookies.txt -d "username=admin&password=YOUR_PASSWORD" -X POST http://localhost:3000/login
# => Set-Cookie: asm.sid=...; redirect to /dashboard

# 5) Run tests (unit tests for auth/CSRF will be added in S2)
npm test
```

### Tests added (this slice)

*None yet* — unit tests for auth middleware, login rate‑limit, CSRF, and protected‑route behavior are planned for **Slice 2**.

### Commit message

```
feat(s1): scaffold project with config validation, login/logout, rate-limit, CSRF, Helmet CSP, Docker files, .gitignore, .env.example, placeholder .gitkeep, beginner guide, and DECISIONS scope note
```

### Status

**Done** — the app starts, `/health` returns 200, `/login` accepts credentials and sets a session cookie. All files listed above exist and pass `npm run lint`.

### Deviations from Phase 3/4

- Authorization fields (`confirmedBy/At`, `proofNonce`, `proofVerifiedAt`, `status`) **removed** from env config and will live on the Target model (Phase 3 specified them in the data model, not env).
- Helmet CSP configured but `'unsafe-inline'` left for scripts/styles as a demo allowance; will tighten with nonces in production.
- `SCOPE_CIDRS` is now an explicit env var (hard outer boundary); Phase 3 implied it via the allowlist collection but the env var makes it deploy-time configurable.
- Login rate‑limit added (Phase 4 milestone).
- CSRF cookie is **not** `httpOnly: true` (so the login form can read it via `document.cookie` for the double‑submit pattern). This is a deliberate trade‑off; a production deployment would switch to a non‑readable token and use the `X-CSRF-Token` header only.

---

## Slice 2 — Target Model, Scope Model, Audit Service

**Goal**: Create Mongoose schemas (Target, Scope, Snapshot, Change, Audit), move auth fields to Target, implement audit service, and add unit/integration tests for auth + CSRF.

### Files to create / change

| File | Plan |
|---|---|
| `src/models/Target.js` | Schema with `hostname`, `ip`, `status` (pending/confirmed/proof_verified/disabled), `confirmedBy`, `confirmedAt`, `proofNonce`, `proofVerifiedAt`, timestamps. |
| `src/models/Scope.js` | Schema for IP/CIDR entries (the per‑target allowlist). |
| `src/models/Snapshot.js` | Schema for snapshots (ports, tls, scannedAt, duration). |
| `src/models/Change.js` | Schema for diff events (type, details, snapshotId, previousSnapshotId). |
| `src/models/Audit.js` | Schema for audit log (event enum, targetId, ipList, actor, timestamp, message). |
| `src/services/auditService.js` | Insert‑only helpers: `logScanAllowed`, `logScanDenied`, `logLogin`, etc. |
| `src/services/proofService.js` | Fetch `/.well-known/{nonce}.txt`, verify content. |
| `tests/unit/auth.test.js` | Wrong password → 401, protected route → 401/redirect, `/health` open. |
| `tests/unit/csrf.test.js` | Missing token → 403, valid token → 200. |
| `tests/integration/auth.test.js` | Full login + session + logout flow. |

### How to run (after implementation)

```bash
npm test        # all unit + integration tests pass
npm run lint    # clean
```

### Tests

- Unit: auth middleware, CSRF, config validation.
- Integration: login POST, session cookie, logout, protected API route returns 401 without session.

### Commit message (planned)

```
feat(s2): add Target/Scope/Snapshot/Change/Audit models, audit service, proof service, unit + integration tests for auth and CSRF
```

### Status

**Planned**

---

## Slice 3 — Resolver & IP Pinning

**Goal**: DNS resolution with `dns.promises`, A/AAAA + CNAME handling, every‑IP scope check against `SCOPE_CIDRS` + per‑target Scope entries, unit tests with mocked DNS.

### Files to create / change

| File | Plan |
|---|---|
| `src/scanner/resolver.js` | `resolveAndVerify(hostname, allowedIpSet)` returns `{ verifiedIps }` or throws. |
| `src/utils/ip.js` | CIDR match helpers using `ipaddr.js`. |
| `tests/unit/resolver.test.js` | Mock `dns.promises`; test allowed, rejected (extra A record), CNAME chain, IPv6. |

### Commit message (planned)

```
feat(s3): resolver with strict IP pinning, CIDR matchers, unit tests with mocked DNS
```

### Status

**Planned**

---

## Slice 4 — Scanner & Snapshot

**Goal**: Rate‑limited TCP/TLS scan on pinned IPs, banner grab, TLS cert extraction (subject, SAN, notAfter, fingerprint), snapshot persistence, per‑target lock.

### Files to create / change

| File | Plan |
|---|---|
| `src/scanner/scanner.js` | Orchestrates concurrent port scans, respects `MAX_CONCURRENT` and `INTER_PORT_DELAY_MS`. |
| `src/scanner/banner.js` | Banner grab with timeout and byte limit. |
| `src/scanner/tls.js` | `tls.connect` with `checkServerIdentity` for cert extraction. |
| `src/services/scanService.js` | High‑level: acquire lock → resolve → scan → snapshot → diff → release lock. |
| `src/utils/lock.js` | In‑memory mutex with TTL (no Redis needed for demo). |

### Commit message (planned)

```
feat(s4): rate-limited TCP/TLS scanner, banner grab, TLS cert extraction, snapshot persistence, per-target lock
```

### Status

**Planned**

---

## Slice 5 — Diff Engine

**Goal**: Compare latest snapshot with previous; baseline handling; emit `port_opened`, `port_closed`, `banner_changed`, `cert_changed`, `cert_expiring` (dedup), `host_added`, `host_removed`; store `snapshotId` + `previousSnapshotId`.

### Files to create / change

| File | Plan |
|---|---|
| `src/services/diffEngine.js` | Pure function diff(oldSnap, newSnap) → Change[]; handles first scan (baseline). |
| `tests/unit/diffEngine.test.js` | Cases: baseline, port open/close, banner change, cert change, cert expiry dedup, host add/remove. |

### Commit message (planned)

```
feat(s5): snapshot diff engine with baseline, port/banner/cert changes, cert-expiring dedup, snapshot refs
```

### Status

**Planned**

---

## Slice 6 — Alert Service & Dashboard

**Goal**: In‑app change feed, optional Mailhog email (fallback to log), EJS + HTMX dashboard showing inventory + global change feed, seeded data for demo.

### Files to create / change

| File | Plan |
|---|---|
| `src/services/alertService.js` | `emitChange(change)` → write to feed + send email (nodemailer). |
| `src/routes/dashboard.js` | `GET /dashboard` renders `views/dashboard.ejs`. |
| `src/routes/changes.js` | `GET /api/changes` (global feed), `GET /api/changes/:targetId`. |
| `views/layout.ejs`, `views/dashboard.ejs`, `views/login.ejs` | Templates with HTMX partials. |

### Commit message (planned)

```
feat(s6): alert service (in-app + Mailhog), EJS+HTMX dashboard, global/per-target change feed routes
```

### Status

**Planned**

---

## Slice 7 — Scheduler & Export

**Goal**: Cron re‑scan for `proof_verified` targets, JSON export of inventory + changes.

### Files to create / change

| File | Plan |
|---|---|
| `src/scheduler/cron.js` | `node-cron` job respecting `CRON_ENABLED` and `CRON_SCHEDULE`. |
| `src/routes/changes.js` (extend) | `GET /api/export` returns JSON dump. |

### Commit message (planned)

```
feat(s7): cron re-scan scheduler, JSON export endpoint
```

### Status

**Planned**

---

## Slice 8 — Tests & CI

**Goal**: Full test coverage, GitHub Actions CI workflow, coverage badge.

### Files to create / change

| File | Plan |
|---|---|
| `.github/workflows/ci.yml` | Lint → unit tests → integration tests (requires MongoDB service). |
| `tests/integration/api.test.js` | Full API flow: login → add target → confirm → verify proof → scan → diff → change feed. |

### Commit message (planned)

```
feat(s8): full test suite, GitHub Actions CI, coverage badge
```

### Status

**Planned**