# Phase 4 — Plan

**Status:** Revised per feedback (ready for review)

---

## Repository Folder Structure

We scaffold **inside the existing team-code repo** (the forked AIORI template), keeping the template's files intact and adding our application alongside them.

```
aiori-hackathon-project/            # existing team repo (A3-PS011-TCxxx)
├── .github/
│   └── workflows/ci.yml            # CI pipeline (lint + unit + integration)
├── docker/
│   ├── docker-compose.yml          # Lab + app stack
│   ├── Dockerfile.app
│   ├── Dockerfile.lab-http
│   ├── Dockerfile.lab-https
│   └── lab-nginx.conf
├── docs/
│   ├── PHASE1-PROBLEM-ANALYSIS.md
│   ├── PHASE2-REQUIREMENTS.md
│   ├── PHASE3-DESIGN.md
│   └── PHASE4-PLAN.md
├── src/
│   ├── index.js                    # App entry point
│   ├── config/
│   │   └── index.js                # Env config + zod validation
│   ├── models/
│   │   ├── Target.js
│   │   ├── Scope.js                # IP/CIDR — single source of truth
│   │   ├── Snapshot.js
│   │   ├── Change.js
│   │   └── Audit.js
│   ├── routes/
│   │   ├── auth.js                 # /login, /logout
│   │   ├── targets.js              # /api/targets (+ confirm, verify-proof)
│   │   ├── scans.js                # /api/scan (+ status polling)
│   │   ├── snapshots.js
│   │   ├── changes.js              # per-target + global feed
│   │   ├── scope.js                # /api/allowlist
│   │   └── dashboard.js            # /dashboard (EJS)
│   ├── middleware/
│   │   ├── auth.js                 # session check
│   │   ├── csrf.js                 # double-submit cookie
│   │   └── error.js
│   ├── scanner/
│   │   ├── resolver.js             # dns.promises + IP pinning
│   │   ├── scanner.js              # rate-limited pinned-IP connect
│   │   ├── banner.js               # banner grab
│   │   └── tls.js                  # built-in tls cert extraction
│   ├── services/
│   │   ├── diffEngine.js           # snapshot diff
│   │   ├── alertService.js         # in-app + email
│   │   ├── auditService.js         # audit writes
│   │   ├── proofService.js         # proof nonce fetch/verify
│   │   └── scanService.js          # orchestration + lock
│   ├── scheduler/
│   │   └── cron.js
│   └── utils/
│       ├── ip.js                   # CIDR match, IPv4/IPv6 parsing
│       ├── lock.js                 # per-target mutex with TTL
│       └── logger.js               # structured logger
├── views/                          # EJS templates
│   ├── layout.ejs
│   ├── login.ejs
│   └── dashboard.ejs
├── tests/
│   ├── unit/
│   │   ├── resolver.test.js
│   │   ├── diffEngine.test.js
│   │   ├── ip.test.js
│   │   └── scanLock.test.js
│   └── integration/
│       └── api.test.js             # owner: Person B
├── .env.example
├── .gitignore
├── package.json
├── eslint.config.js
├── jest.config.js
├── README.md
└── DECISIONS.md
```

---

## Branching Strategy

| Branch | Purpose |
|---|---|
| `main` | Stable, working code. Protected: no direct pushes. |
| `feat/<scope>` | Short‑lived feature branches (e.g. `feat/resolver-pinning`). |
| `fix/<scope>` | Bug fixes. |
| `docs/<scope>` | Documentation updates. |
| `chore/<scope>` | CI, config, dependency updates. |

**PR Workflow**

1. Branch from `main`, commit in small logical chunks.
2. Open PR → `main`.
3. CI runs: `npm run lint` + `npm run test:unit` + `npm run test:integration`.
4. At least one approval (the other teammate) — **the teammate who did not write the code**.
5. **Squash merge** into `main` (one clean commit per PR; feature branch history is not fast‑forwarded into `main`).
6. Delete the feature branch after merge.

**Owners (single owner each):**

| Artifact | Owner |
|---|---|
| `tests/integration/` | **Person B** |
| `.github/workflows/ci.yml` | **Person A** |

---

## Commit Message Convention

We use **Conventional Commits**. **Attribution trailers are the team owner's decision** — the template below omits any trailer by default; add one only if the team agrees on it in writing.

```
<type>(<scope>): <subject>

<body>
```

| Type | When to use |
|---|---|
| `feat` | New user-facing feature |
| `fix` | Bug fix |
| `refactor` | Restructuring without behavior change |
| `test` | Adding/changing tests |
| `docs` | Documentation only |
| `chore` | Build, CI, dependency updates |
| `style` | Formatting only |

**Examples**

```
feat(resolver): add DNS A/AAAA resolution with IP pinning

- Verifies every resolved IP against the scope list
- Rejects target if any IP is out-of-scope
- Unit tests with mocked DNS
```

```
fix(scanner): prevent connection attempt when pinning fails

- Guard early return before socket creation
- Audit log records denied attempt
```

---

## Milestones & Task Breakdown

Budget: **36 useful hours** + **~15–20% contingency (≈ 6h)** ≈ **42h** planned envelope.

| Milestone | Owner | Duration | Goal | Key Deliverables |
|---|---|---|---|---|
| **M1 – Skeleton & Config** | A | 3h | Express + Helmet + Mongoose + logger + zod config; `.env.example`; repo scaffold inside template | `src/index.js`, `src/config/`, `src/utils/logger.js`, `eslint.config.js`, `jest.config.js`, `package.json` |
| **M2 – Models & Audit Service** | A | 3h | Mongoose schemas (Target, Scope, Snapshot, Change, Audit); audit service; insert-only role setup script | `src/models/*`, `src/services/auditService.js`, `docker/init-mongo.js` |
| **M3 – Login & Session** | B | 3h | Login form, session cookie, constant‑time credential compare, CSRF double‑submit, logout; all routes protected except `/health` | `src/routes/auth.js`, `src/middleware/auth.js`, `src/middleware/csrf.js`, `views/login.ejs` |
| **M4 – Scope & Authorization** | A | 4h | Target CRUD, status machine (`pending`→`confirmed`→`proof_verified`), confirm + verify‑proof endpoints, scope = IP/CIDR single source of truth | `src/routes/targets.js`, `src/routes/scope.js`, `src/services/proofService.js`, `src/utils/ip.js` |
| **M5 – Resolver & Pinning** | A | 4h | `dns.promises` A/AAAA + CNAME handling, every‑IP scope check, pinned‑IP connect, private ranges + IPv6 | `src/scanner/resolver.js`, `src/utils/ip.js` |
| **M6 – Scanner & Snapshots** | A | 5h | Rate‑limited TCP/TLS scan on pinned IPs, banner/service capture, TLS cert fields, snapshot persistence, per‑target scan lock | `src/scanner/scanner.js`, `src/scanner/banner.js`, `src/scanner/tls.js`, `src/services/scanService.js`, `src/utils/lock.js` |
| **M7 – Diff Engine** | **B** | 4h | Snapshot diff: baseline on first scan, skip failed/partial, host by IP, port/banner/cert diffs, `cert_expiring` dedupe, `snapshotId`/`previousSnapshotId` refs | `src/services/diffEngine.js`, `tests/unit/diffEngine.test.js` |
| **M8 – Alerts & Change Feed** | **B** | 3h | Alert service (in‑app + Mailhog email with log fallback); per‑target + global change feed endpoints | `src/services/alertService.js`, `src/routes/changes.js`, `tests/integration/api.test.js` |
| **M9 – Dashboard** | **B** | 4h | EJS + HTMX dashboard: inventory, per‑target history, global feed; built against seeded data | `views/dashboard.ejs`, `views/layout.ejs`, `src/routes/dashboard.js` |
| **M10 – Scheduler & JSON Export** | A | 2h | Cron re‑scan for `proof_verified` targets only; JSON export of inventory + changes | `src/scheduler/cron.js`, `src/routes/changes.js` (export) |
| **M11 – Test Suite** | A (unit) / B (integration) | 4h | Unit tests (resolver, ip, diff, lock) + integration tests (auth, scope gate, scan flow, diff) | `tests/unit/*`, `tests/integration/api.test.js` |
| **M12 – Docker Lab & Hardening** | A | 4h | Compose lab (Mongo, app, Mailhog, HTTP/HTTPS lab hosts, swappable cert, nginx proof file), Helmet CSP, README | `docker/*`, `README.md` |
| **M13 – Delivery** | B | 4h | AIORI presentation PDF (11 sections), demo script, Level 1 GitHub/video steps | `docs/slides.pdf`, `docs/DEMO-SCRIPT.md` |

**Planned: A ≈ 21h, B ≈ 21h.** Contingency ≈ 6h, split by whoever is behind.

---

## Work Split (2 People)

| Person | Owns |
|---|---|
| **A (Backend/Scanner)** | M1, M2, M4, M5, M6, M10, M11(unit), M12, CI workflow |
| **B (Dashboard/Changes/Docs)** | M3, M7, M8, M9, M11(integration), M13, integration test suite |
| **Shared** | Demo rehearsals; code review of each other's PRs; "cannot scan out of scope" is reviewed by both |

**Single owners:** `tests/integration/` → **B**; `.github/workflows/ci.yml` → **A**.

---

## Contingency & Cut List (ordered)

If time runs short, cut in this order. Each item is dropped *last-in-first-out* — cut from the bottom of the list first.

1. `M10` JSON export (Should in MoSCoW)
2. `M10` cron scheduler → manual re-scan only (Should)
3. `M8` email alerts → in‑app feed only, keep the log fallback (Should)
4. `M8` global change feed → per‑target only (Should)
5. `M7` `banner_changed` event type (Should)
6. `M9` HTMX live refresh → plain page refresh (Should)
7. `M4` proof file verification → manual confirmation only (Should) — **never cut the scope gate itself**
8. `M12` Docker Compose lab hardening → run lab services manually (Should)

**Never cut:** scope gate + IP pinning + audit log + login/session + diff engine + snapshot persistence + README legal notice + AIORI Level 1 process steps. These are Must per Phase 2, and they are the whole point of the project.

---

## CI Pipeline (`.github/workflows/ci.yml`)

```yaml
name: CI
on: [push, pull_request]
jobs:
  lint-test:
    runs-on: ubuntu-latest
    services:
      mongodb:
        image: mongo:7
        ports: [27017:27017]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run lint
      - run: npm run test:unit
      - run: npm run test:integration
```

No TypeScript in the stack — no type-check step.

---

## Dependencies

**Runtime:** `express`, `mongoose`, `express-session`, `helmet`, `zod`, `nodemailer`, `ejs`, `node-cron`, `pino`, `pino-http`, `ipaddr.js`, `connect-redis` (optional — demo uses in-memory session store), `htmx.org` (static asset).

**Built-in (no package):** `dns.promises` (resolution), `tls` (certificate extraction), `net` (TCP connect), `crypto` (constant‑time compare), `http`/`https` (proof fetch + banner).

**Dev:** `jest`, `supertest`, `eslint`, `nodemon`.

Note: `dns2` from the earlier draft is dropped — `dns.promises` is built in and sufficient. `tls` is likewise built in, so no `node-tls` package.

---

## Next Steps

1. **Review** this revised plan (branching, milestones, work split, cut list).
2. **Approve** — then Phase 5 (Build) begins with M1 skeleton.
3. Initialize the app scaffold inside the existing team repo: `npm init`, install deps, add `eslint.config.js` + `jest.config.js`, create `src/` tree, keep the AIORI template files untouched.