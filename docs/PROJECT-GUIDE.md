# Project guide

## Purpose and safety boundary

AIORI PS-011 is an authorized asset inventory and change monitor. Use it only on systems you own or are explicitly authorized to test. It performs discovery only; there is no exploitation, brute force, or fuzzing. An empty `SCOPE_CIDRS` fails closed.

The app validates a target's configured IP against `SCOPE_CIDRS` at creation and again before a scan. DNS answers are checked in full, and the scanner connects to the validated numeric IPs rather than resolving the hostname again. A target must be operator-confirmed and, by default, pass the nonce proof-file check before scanning.

## Current flow

1. Sign in at `/login`; the admin credentials come from `.env`.
2. Add a hostname/IP inside `SCOPE_CIDRS` and acknowledge authorization.
3. Confirm authorization for the target; the app records operator and timestamp.
4. Publish the shown nonce at `/.well-known/as-inventory-auth.txt` on the target, then select **Verify proof**. Redirects are rejected.
5. Start a scan. The server audits the request before network activity, checks scope again, resolves/pins addresses, enforces a per-target lock, then probes only server-configured ports.
6. Successful scan results are stored as snapshots. The first is a baseline; later successful scans produce persisted changes and log alerts. Failed scans do not create diffs.
7. Review Inventory, Changes, and the read-only Audit page.

## Components

| Path | Responsibility |
|---|---|
| `src/config/index.js` | Zod-validated environment configuration and fail-closed defaults. |
| `src/routes/` | Login, target, scan, audit API, and authenticated dashboard routes. |
| `src/scanner/` and `src/services/scanner.js` | DNS resolution, scope checks, pinned TCP/TLS/HTTP discovery, and bounded probes. |
| `src/services/diffEngine.js` | Pure snapshot comparison; emits baseline-free port/banner/certificate/host changes. |
| `src/services/changeService.js` | Persists changes and logs one alert per change. |
| `src/services/auditService.js` | Audit insert and read operations; no API update/delete route. |
| `src/models/` | Mongoose target, snapshot, change, scan-job, and audit schemas. |
| `views/` | EJS login and shared dashboard layout with Inventory, Changes, and Audit pages. |
| `scripts/lab.mjs` | Loopback HTTP/HTTPS/proof lab and optional TCP listener. |
| `scripts/verify.mjs` | Automated end-to-end verification against a unique database. |

## Windows developer setup

Install Node.js 20+, MongoDB, and Git for Windows (for OpenSSL). From PowerShell:

```powershell
npm ci
Copy-Item .env.example .env
```

Edit `.env`: set a strong admin password and unique session secret, use `SCOPE_CIDRS=127.0.0.1/32` and `SCAN_PORTS=8080,8443,9100` for the local demo, and set `PROOF_HTTP_PORT=8080`. `.env`, `node_modules`, and `.lab-data` are gitignored.

Run the lab and app in separate terminals. Set `SCAN_PORTS=8080,8443,9100` in `.env` for this demo:

```powershell
npm run lab
npm start
```

Open `http://127.0.0.1:3000/login`. After adding the demo target, copy the displayed nonce into `.lab-data\proof.txt`, then confirm, verify proof, and scan. Use `npm run lab:open-port` and `npm run lab:swap-cert` before the second scan to demonstrate change detection.

Run checks with `npm run lint`, `npm test`, or `npm run verify`. Stop the manual app and lab before `npm run verify`, since it starts its own instances. Tests use the dedicated `aiori_test` database; end-to-end verification uses its own uniquely named database and closes it.

## Honest status

| Feature | Status | Evidence / limits |
|---|---|---|
| Config validation, login/session, CSRF, Helmet, login rate limiting | Done | Implemented and covered by Jest. |
| Scope checks, authorization checkbox/confirmation, nonce proof | Done | Checked at creation and scan time; proof is HTTP without redirects. |
| Real TCP, HTTP, and TLS probes | Done | Real local-server tests and end-to-end lab check. |
| Snapshots, baseline, diff, alert log | Done | Unit fixtures and end-to-end checks for port/certificate changes. |
| Insert-only audit service/API and read-only dashboard | Done | Audit events persisted; no audit mutation route. |
| Local HTTP/HTTPS/TCP lab and verify script | Done | Scripts run on loopback; self-signed cert generated with OpenSSL. |
| Email delivery, scheduled rescans, export | Planned | Not implemented. |
| Distributed scan locking and production deployment | Planned | Current lock is process-local; this project is a single-process demo. |

For the timed demo, see [DEMO-SCRIPT.md](DEMO-SCRIPT.md). Project decisions are recorded in [DECISIONS.md](../DECISIONS.md).
