# Project guide for beginners

## 1. The problem in plain words
Imagine you are the **security guard** for a small company's internal network. Every morning someone opens a new port, updates a TLS certificate, or adds a new host. If you keep a handwritten list of all assets, it quickly gets out-of-date and you can't prove that you ever scanned the right machines.

**Our tool** does what a professional security team would do, but in a **few days** for a hackathon:
- **Discover** the internet-facing assets you are allowed to scan (domains, IPs, open ports, banners, TLS certificates).
- **Take a snapshot** of that inventory.
- **Re-scan later** and automatically highlight what changed (new port, expired cert, new host, banner change).
- **Alert** the operator (in-app feed and optional email) so they can act.

The whole thing runs only on **targets you explicitly authorise** - no accidental internet-wide scanning.

---

## 2. Glossary (quick definitions)
| Term | What it means |
|---|---|
| **Attack surface** | All the network endpoints (hosts, ports, services) an attacker could reach. |
| **Asset** | A host/IP/port combination that we monitor. |
| **Scope** | The list of IP ranges (CIDR) that the tool is allowed to touch. |
| **Allowlist** | Same as *scope* - a set of IPs/CIDRs that are pre-approved. |
| **CIDR** | Notation like `10.0.0.0/24` that describes a block of IP addresses. |
| **DNS** | System that turns a hostname (`web.lab`) into one or more IP addresses. |
| **Port** | A numeric endpoint on a host (e.g., `80` for HTTP). |
| **Banner** | Text a service prints when you open a TCP connection (e.g., `nginx`). |
| **TLS certificate** | Public key material a server presents for HTTPS; we record its fingerprint and expiry date. |
| **Fingerprint** | A hash of the certificate - helps us know if it changed. |
| **Snapshot** | A full inventory taken at a point in time. |
| **Diff** | Comparison between the latest snapshot and the previous one. |
| **Baseline** | The first successful snapshot - it has no "change" output. |
| **Audit log** | Append-only record of every important event (login, allowlist change, scan start/deny). |
| **Rate limit** | Throttling of requests (e.g., login attempts) to stop brute-force. |
| **Session** | Server-side data (cookie) that remembers a logged-in user. |
| **CSRF** | Cross-Site Request Forgery - a token we validate on every state-changing request. |
| **XSS** | Cross-Site Scripting - prevented by escaping output and a strict CSP. |
| **NoSQL injection** | Malicious query data sent to MongoDB; avoided by validating all inputs with **Zod**. |
| **Middleware** | Functions that sit between the request and the route handler (e.g., auth, CSRF). |
| **Rate limiting** | Limits how many times an endpoint can be called per time window. |

---

## 3. Architecture (plain language)
1. **Frontend** - simple HTML pages rendered with EJS; a login form, a dashboard, and a few HTM​X-enabled buttons.
2. **Express server** - handles the HTTP API, serves the pages, and applies security middleware (Helmet, CSRF, auth, rate-limit).
3. **MongoDB** - stores:
   - **Targets** (hostname/IP, status, proof nonce, timestamps).
   - **Scope CIDRs** (the hard outer boundary).
   - **Snapshots** (port list, banners, TLS data).
   - **Changes** (diff events).
   - **Audit log** (insert-only collection - never updated or deleted).
4. **Resolver** - uses Node's built-in `dns.promises` to resolve A/AAAA records, follows CNAME chains, and checks that **every** resolved IP is inside the allowed CIDR list.
5. **Scanner** - rate-limited TCP/TLS connections *only* to the **pinned** IPs that passed the resolver. Banners and TLS certs are collected.
6. **Diff engine** - when a scan finishes, it compares the new snapshot with the previous one and creates `Change` documents (`port_opened`, `port_closed`, `banner_changed`, `cert_changed`, `cert_expiring`, `host_added`, `host_removed`).
7. **Alert service** - writes a change to the global feed and, if SMTP is configured, sends a plain-text email via Mailhog.
8. **Scheduler** - optional cron that reruns scans for all `proof_verified` targets.

**Diagram (ASCII)**
```
+-----------------+        +-----------------+        +-----------------+
|   Browser       | <----> |   Express API   | <----> |   MongoDB       |
| (login, dashboard)      | (auth, CSRF,   |        | (targets,       |
+-----------------+        |  rate-limit,   |        |  snapshots,    |
                           |  scanner)      |        |  changes, audit |
+-----------------+        +-----------------+        +-----------------+
|   Resolver (dns) | ------> |  Scanner (net)  | ------> |   Network Lab   |
+-----------------+        +-----------------+        +-----------------+
```
---

## 4. One scan from start to finish (step-by-step)
1. **Login** - POST `/login` with admin username/password. Rate-limited, CSRF-protected, session cookie set.
2. **Add a target** - POST `/api/targets` with `{ hostname: "web.lab" }`. The API stores the target with `status: "pending"` and generates a random `proofNonce`.
3. **Confirm authorization** - POST `/api/targets/:id/confirm` (operator clicks a button). The server records `confirmedBy`, `confirmedAt`, and sets `status: "confirmed"`.
4. **Proof file check** - POST `/api/targets/:id/verify-proof`. The server fetches `https://web.lab/.well-known/<nonce>.txt` (timeout 3s). If the content matches, `proofVerifiedAt` is set and `status: "proof_verified"`.
5. **Start a scan** - POST `/api/scan/:id`. The scan service:
   - Checks `status === "proof_verified"` (or `confirmed` if the proof step is disabled).
   - Acquires a per-target lock (so two scans never run concurrently).
   - Calls the **Resolver** - resolves all A/AAAA, follows CNAMEs, verifies each IP is inside the outer `SCOPE_CIDRS` (hard boundary) **and** the per-target `allowedIpSet`.
   - If any IP is out-of-scope, the scan is **aborted**, `audit` logs a `scan_denied` event, and **no packets are sent**.
   - If ok, the **Scanner** contacts each allowed IP, respecting `MAX_CONCURRENT` and `INTER_PORT_DELAY_MS`. It records open/closed ports, banner strings, and TLS cert fingerprint/expiry.
   - Stores a **snapshot** document.
6. **Diff** - After the snapshot is saved, `diffEngine` loads the previous snapshot (if any). If it's the first one, it becomes the **baseline** (no diff output). Otherwise it creates `Change` entries and pushes them to the **global feed**.
7. **Alert** - `alertService` writes the change to the dashboard feed and, if SMTP is configured, sends an email (`Mailhog` in dev).
8. **Dashboard** - The operator reloads `/dashboard` (or HTMX auto-refresh). The page shows the current inventory and a list of recent changes.
---

## 5. File-by-file walkthrough (what each file does)
| File | Role |
|---|---|
| `package.json` | NPM manifest - lists dependencies, scripts (`npm start`, `npm test`, `npm run lint`). |
| `eslint.config.js` | Linter configuration - catches syntax/format errors early. |
| `jest.config.js` | Test runner config - runs unit and integration suites. |
| `.env.example` | Template for env vars. Developers copy to `.env` and fill real secrets. |
| `src/config/index.js` | Centralised env-validation with Zod; fails fast on weak/placeholder secrets; defines `config` object used everywhere. |
| `src/utils/logger.js` | pino logger (pretty output) and a helper `connectMongo()` that logs connection status. |
| `src/app.js` | Express factory - sets up Helmet, session, CSRF, rate-limit on `/login`, routes, and error handling. Returns the app for tests. |
| `src/index.js` | Entry point - calls `connectMongo()`, creates the app, starts the HTTP server. |
| `src/middleware/auth.js` | Auth guard - constant-time credential compare, redirects unauthenticated HTML requests, returns 401 JSON for API. |
| `src/middleware/csrf.js` | Double-submit cookie CSRF protection - issues token on safe methods, validates on mutating methods. |
| `src/middleware/error.js` | Global error catcher - logs error, hides stack trace in production. |
| `src/routes/auth.js` | Handles `GET /login` (form), `POST /login` (session creation), `POST /logout` (destroy). Uses `safeEqual` to avoid timing leaks. |
| `src/routes/*` (empty for now) | Placeholders where the rest of the API will live: targets, scope, scans, snapshots, changes, dashboard. |
| `src/models/*` (empty) | Mongoose schemas for Target, Scope, Snapshot, Change, Audit - will be added in the next slice. |
| `src/scanner/*` (empty) | Resolver, scanner, TLS extraction - will use built-in `dns.promises` and `tls`. |
| `src/services/*` (empty) | Diff engine, alert service, audit service, proof verification - each a single-purpose module. |
| `src/scheduler/cron.js` | Optional cron that runs re-scan jobs (later slice). |
| `views/*.ejs` | Server-side templates - login page, dashboard, layout. |
| `docker/docker-compose.yml` | Spins up MongoDB and the Node app for local development. |
| `docker/Dockerfile.app` | Minimal Alpine-based image that runs `npm start`. |
---

## 6. How to run, test and demo
```bash
# 1. Clone the repo and install deps
git clone <repo-url> aiori-hackathon
cd aiori-hackathon
cp .env.example .env   # then edit .env - set ADMIN_PASSWORD, SESSION_SECRET, etc.

# 2. Start MongoDB (Docker) and the app
docker compose up -d   # brings up MongoDB
npm start               # server listens on http://localhost:3000
```

**Run the health check** (no auth needed):
```bash
curl http://localhost:3000/health
# => {"status":"ok","time":"2026-10-28T..."}
```

**Login with curl** (demo only, no CSRF token needed for `curl` because we are not using a browser):
```bash
curl -i -c cookies.txt -d "username=admin&password=change-me-in-production-min-8-chars" \
     -X POST http://localhost:3000/login
# Server responds with a Set-Cookie header that stores the session.
```

**Protected route test** (should redirect to /login when not authenticated):
```bash
curl -i http://localhost:3000/api/targets   # 401 JSON because no session
```

**Run the test suite** (includes auth & CSRF tests added in the next slice):
```bash
npm test   # runs Jest - should pass all unit tests.
```
---

## 7. Security decisions (why we made them)
| Decision | Reason |
|---|---|
| **Fail-closed defaults** | Empty `SCAN_PORTS` and empty `SCOPE_CIDRS` mean the app does nothing until the operator explicitly configures it. |
| **IP pinning** | The resolver checks **every** resolved IP against the allowlist; if any are out-of-scope the scan aborts - prevents DNS rebinding attacks. |
| **Proof-file step** | Adds a second factor of authorization - the operator must upload a file at `/.well-known/<nonce>.txt` on the target, proving they control it. |
| **Insert-only audit log** | Auditing is immutable - we give the MongoDB audit collection an insert-only role so logs cannot be edited. |
| **Constant-time credential compare** | Prevents timing attacks that could guess the password byte-by-byte. |
| **Rate limiting on `/login`** | Stops credential-stuffing/brute-force attacks. |
| **CSRF double-submit cookie** | Guarantees that a state-changing request originates from a page the user loaded from our domain. |
| **Helmet + CSP + EJS escaping** | Defense-in-depth against XSS: CSP blocks inline scripts (except a temporary `'unsafe-inline'` for the demo), and EJS automatically HTML-escapes `<%= %>` values. |
| **Zod validation** | Guarantees that any data entering the database is the type/shape we expect, eliminating NoSQL injection vectors. |
---

## 8. Pitch scripts
### 2-minute pitch (approx 120s)
> "Our project, the **Authorized Attack-Surface Monitor**, helps a small-team SOC keep an up-to-date inventory of all internet-facing assets. The operator adds a host, confirms they own it, and optionally uploads a proof file. The scanner then resolves the host, pins every IP to a pre-approved CIDR list, and runs a rate-limited TCP/TLS scan on a small set of ports. The first successful scan becomes a baseline; subsequent scans produce a diff (new ports, changed banners, expiring certs) displayed on a simple web dashboard and optionally emailed. All actions are logged in an insert-only audit collection, and the tool refuses to scan anything outside the explicit allowlist, satisfying the hackathon's 'authorized only' rule."

### 5-minute pitch (approx 300s)
> *Problem*: Security teams waste hours maintaining spreadsheets of assets that quickly become stale. Accidentally scanning the Internet can also breach legal/ethical boundaries.
> 
> *Solution*: A Node.js/Express app backed by MongoDB that:
> 1. Stores **targets** with a status workflow (`pending -> confirmed -> proof_verified`).
> 2. Resolves hostnames using the built-in DNS module, **verifies every IP** against a global CIDR allowlist (hard outer boundary) and the per-target allowed set.
> 3. Performs **rate-limited TCP/TLS scans** (no redirects, only pinned IPs). Collects banners and TLS certificate data.
> 4. Persists a **snapshot**; the next scan runs a **diff engine** that emits change events (`port_opened`, `cert_changed`, etc.).
> 5. Shows the changes on a dashboard and, if configured, sends an email via Mailhog.
> 6. Logs every step (login attempts, scope changes, scan start/deny) in an **append-only audit collection**.
> 
> *Security-by-design*: 
> - **Fail-closed** - default config scans nothing.
> - **IP pinning** - prevents DNS rebinding.
> - **Proof file** - second factor proof of ownership.
> - **Constant-time credential compare** and **login rate limiting** - stop brute-force.
> - **CSRF token**, **Helmet + CSP**, **EJS escaping** - mitigate XSS.
> - **Zod validation** - eliminates NoSQL injection.
> 
> *Demo flow*: Log in -> add `web.lab` -> confirm -> upload proof file -> start scan -> see dashboard list of open ports and a diff entry that a new port opened.
> 
> *Why it wins*: Meets the AIORI-3 hard rule (authorized only), provides a clean UI, logs everything for audit, and runs entirely on open-source tools that anyone can reproduce.
---

## 9. Likely judges' questions (with short answers)
1. **How do you guarantee you never scan an out-of-scope IP?**
   - The resolver checks *every* resolved IP against the `SCOPE_CIDRS` outer boundary and the per-target allowlist; any mismatch aborts the scan and logs `scan_denied`. No socket is opened.
2. **What stops an attacker from forging the proof file?**
   - The proof file path contains a random nonce generated on confirmation. An attacker must control the target's web server to place that exact file - proving ownership.
3. **Why store the audit log in an insert-only collection?**
   - To make the log tamper-evident; MongoDB role permissions prevent updates/deletes, matching compliance needs.
4. **How does the rate-limit work for login?**
   - `express-rate-limit` caps attempts (default 10 per 15 min) per IP, preventing credential-stuffing.
5. **Can the scanner be used for denial-of-service attacks?**
   - No: the scanner respects `MAX_CONCURRENT` sockets and `INTER_PORT_DELAY_MS`; it also obeys the global `SCOPE_CIDRS` and per-target lock, limiting total traffic.
6. **Why use EJS instead of a SPA framework?**
   - Simpler for a 36-hour hackathon, no build step, automatic HTML escaping, and easy server-side rendering.
7. **What happens if a DNS record returns both an allowed and a disallowed IP?**
   - The scan is aborted; security policy is "all-or-nothing".
8. **How are certificates compared?**
   - By SHA-256 fingerprint; expiry is also stored and checked against `CERT_EXPIRY_THRESHOLD_DAYS`.
9. **Do you store passwords in plain text?**
   - No; `ADMIN_PASSWORD` is stored only in env vars and compared with `crypto.timingSafeEqual`. In a production deployment you would hash it.
10. **How would you add support for IPv6?**
    - The resolver already returns A and AAAA records; the CIDR matcher works with `ipaddr.js` which supports IPv6.
11. **Can you export the inventory?**
    - A future "export" endpoint will JSON-dump the latest snapshots; the milestone for that is planned.
12. **How does the app behave when MongoDB is down?**
    - It fails to start (`connectMongo()` throws) and logs a fatal error - prevents an unauthenticated state.
13. **Why not use a cloud DB with built-in audit?**
    - The hackathon expects a local Docker-compose lab; using MongoDB keeps the stack simple and portable.
14. **What is the purpose of the `SCOPE_CIDRS` outer boundary?**
    - It guarantees the tool can never be misconfigured to scan the public Internet; even a compromised target record cannot bypass this hard limit.
15. **How do you prevent NoSQL injection?**
    - All incoming JSON is validated with Zod schemas before being passed to Mongoose; unknown fields are stripped.
---

## 10. Status (what's Done / Planned)
| Slice | Description | Status |
|---|---|---|
| **S1 - Skeleton & Config** | Project scaffold, env validation, logger, app factory, login/logout routes, rate-limit, CSRF, Helmet, `.gitignore`, `.env.example`, Docker files, basic tests placeholder. | **Done** (verified with `npm start` and `curl /health`, `curl /login` works) |
| **S2 - Target model, Scope model, Audit service** | Add Mongoose schemas, move authorization fields to Target, implement audit log insertion, record outer-boundary relationship in DECISIONS.md. | **Planned** |
| **S3 - Resolver & IP pinning** | DNS resolution, CIDR check, reject-on-out-of-scope, unit tests. | **Planned** |
| **S4 - Scanner & Snapshot** | Rate-limited TCP/TLS scan, banner capture, snapshot persistence. | **Planned** |
| **S5 - Diff engine** | Baseline handling, change detection, dedup cert-expiring, banner/service diff. | **Planned** |
| **S6 - Alert service & Dashboard** | In-app feed, optional Mailhog email, EJS dashboard UI. | **Planned** |
| **S7 - Scheduler & Export** | Cron re-scan, JSON export endpoint. | **Planned** |
| **S8 - Tests & CI** | Full unit + integration test suite, GitHub Actions CI workflow, coverage badge. | **Planned** |

Keep this file (`docs/PROJECT-GUIDE.md`) up-to-date; after each slice you will see new sections added.