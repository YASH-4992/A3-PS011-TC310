# Architecture

## Components

| Component | Responsibility |
|---|---|
| `src/app.js` | Express setup, strict Helmet CSP, static same-origin CSS, sessions, CSRF, rate limit, and route mounting. |
| `src/routes/auth.js` | Admin login/logout, session lifecycle, and login audit. |
| `src/routes/targets.js` | Validates targets, enforces scope at creation, records authorization, and verifies the proof file. |
| `src/routes/scans.js` | Audit-first scan request, authorization status gate, background scan, job status, and successful-scan diff call. |
| `src/routes/dashboard.js` | Authenticated overview, inventory, changes, audit, and how-it-works pages. |
| `src/services/resolver.js`, `scanner.js` | DNS resolution/validation and bounded TCP, TLS, and HTTP discovery against pinned IPs. |
| `src/services/diffEngine.js` | Pure baseline-aware comparison of successful snapshots. |
| `src/services/changeService.js` | Persists changes and emits an application-log alert for each change. |
| `src/services/auditService.js` | Audit insert and read operations. |
| `scripts/lab.mjs`, `scripts/verify.mjs` | Local loopback lab and automated end-to-end verification. |

## Data model

| Collection | Key fields |
|---|---|
| `Target` | `hostname`, `ip`, `label`, `status`, `confirmedBy`, `confirmedAt`, `proofNonce`, `proofVerifiedAt` |
| `Snapshot` | `target`, `scanId`, `ports[]` (IP, port, protocol, banner, HTTP facts, TLS facts), `status`, `startedAt`, `completedAt`, `durationMs` |
| `Change` | `target`, `snapshotId`, `previousSnapshotId`, `type`, `severity`, `details`, `port` |
| `Audit` | `event`, `actor`, `targetId`, `ip`, `message`, timestamps |
| `ScanJob` | `scanId`, `target`, `status`, `requestedBy`, lifecycle timestamps, `snapshotId`, error |
| Mongo session collection | Session data managed by `connect-mongo`. |

## Scan flow

1. Authenticated operator submits a CSRF-protected scan request for a target.
2. The route checks target state. The target must be confirmed and, when `REQUIRE_PROOF_BEFORE_SCAN` is enabled, proof-verified.
3. A `scan_started` audit entry is inserted before a scan job is launched. If that insert fails, the request is refused.
4. A process-local per-target lock prevents concurrent scans of the same target in this application instance.
5. The scanner re-checks the target IP against `SCOPE_CIDRS`, resolves the hostname, checks every resolved address against scope, and uses numeric pinned addresses for connections. TLS SNI and the HTTP Host value use the original hostname.
6. Only configured ports are probed, with bounded timeouts, concurrency, delay, response size, and no HTTP redirects.
7. The result is stored as a snapshot. Failed scans do not reach the diff operation. If diff processing fails after snapshot creation, the snapshot is marked failed.
8. The first successful scan is the baseline. A later successful result is compared to the prior successful snapshot; change records hold both snapshot references and are logged.
9. Completion/failure and operator actions are recorded in the audit collection.

## Diff rules

`diffEngine(previous, next)` is pure. A missing previous successful snapshot produces no changes (baseline). For later comparisons it can report:

- `port_opened` / `port_closed`
- `banner_changed`
- `cert_changed`
- `host_added` / `host_removed` by observed IP

Each persisted change references `snapshotId` and `previousSnapshotId` and carries a severity. The dashboard orders changes newest first.

## Security controls

| Control | Implementation |
|---|---|
| Empty scope denies all; target scope checked at creation | `src/utils/ip.js`, `src/routes/targets.js` |
| Scope rechecked, all DNS answers checked, connections pinned | `src/services/resolver.js`, `src/services/scanner.js` |
| Explicit operator confirmation and proof gate | `src/routes/targets.js`, `src/routes/scans.js` |
| Audit before scan network activity | `src/routes/scans.js`, `src/services/auditService.js` |
| Session authentication and login rate limiting | `src/app.js`, `src/routes/auth.js`, `src/middleware/auth.js` |
| CSRF protection for state-changing requests | `src/app.js`, `src/middleware/csrf.js` |
| Strict self-only CSP and secure response headers | `src/app.js` |
| Escaped server-rendered output | `views/*.ejs` |
| Bounded probes/no redirects/config-only ports | `src/services/scanner.js`, `src/config/index.js` |
| Audit has no application update/delete route | `src/services/auditService.js`, `src/routes/audit.js` |
