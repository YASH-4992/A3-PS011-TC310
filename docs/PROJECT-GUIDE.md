# Project guide

## Purpose and safety boundary

AIORI PS-011 is an authorized asset inventory and change monitor. Use it only on systems you own or are explicitly authorized to test. It performs discovery only; there is no exploitation, brute force, or fuzzing. An empty `SCOPE_CIDRS` fails closed.

The target IP is checked against `SCOPE_CIDRS` at creation and again before a scan. DNS answers are checked in full, and the scanner connects to validated numeric IPs rather than resolving the hostname again. A target must be operator-confirmed and, by default, pass the nonce proof-file check before scanning.

## Current flow

1. Sign in at `/login`; credentials come from `.env`.
2. Open Overview to see actual inventory progress and the active scope.
3. Add a hostname/IP inside `SCOPE_CIDRS` and acknowledge authorization.
4. Confirm authorization; the app records operator and timestamp.
5. Publish the shown nonce at `/.well-known/as-inventory-auth.txt` on the target, then select **Verify proof**. Redirects are rejected.
6. Start a scan. The server audits the request before network activity, checks scope again, resolves and pins in-scope addresses, enforces a per-target lock, then probes only server-configured ports.
7. Successful scan results are stored as snapshots. The first is a baseline; later successful scans produce persisted changes and log alerts. Failed scans are never diffed.
8. Review Inventory, Changes, and the read-only Audit page. **How it works** explains the terms and stages.

## Components

| Path | Responsibility |
|---|---|
| `src/config/index.js` | Zod-validated environment configuration and fail-closed defaults. |
| `src/routes/` | Login, target, scan, audit API, and authenticated dashboard routes. |
| `src/services/` | DNS resolution, scope checks, pinned TCP/TLS/HTTP discovery, diffing, audit, and change persistence. |
| `src/models/` | Mongoose target, snapshot, change, scan-job, audit, and session schemas. |
| `views/` | Escaped EJS pages: Overview, Inventory, Changes, Audit, and How it works. |
| `public/css/app.css` | Same-origin responsive interface styling; no inline CSS or CDN. |
| `scripts/lab.mjs` | Loopback HTTP/HTTPS/proof lab and optional TCP listener. |
| `scripts/verify.mjs` | Automated end-to-end verification against a unique database. |
| `docs/` | Evaluator, architecture, security, and demo documentation. |

## Windows developer setup

Install Node.js 20+, MongoDB (local or Atlas), and Git for Windows (for OpenSSL). From PowerShell:

```powershell
npm install
Copy-Item .env.example .env
```

Set `ADMIN_USERNAME`, a strong `ADMIN_PASSWORD`, a unique `SESSION_SECRET` (at least 16 characters), `SCOPE_CIDRS=127.0.0.1/32`, `SCAN_PORTS=8080,8443,9100`, and `PROOF_HTTP_PORT=8080` for the local demo. Keep `REQUIRE_PROOF_BEFORE_SCAN=true`. `.env`, `node_modules`, cookie text files, and `.lab-data` are gitignored.

Run the lab and app in separate terminals:

```powershell
npm run lab
npm start
```

Open `http://localhost:3000`. Add loopback, confirm authorization, and copy the displayed nonce into `.lab-data\proof.txt`:

```powershell
Set-Content -NoNewline .\.lab-data\proof.txt '<nonce-shown-in-inventory>'
```

Verify proof, scan, then use `npm run lab:open-port` and `npm run lab:swap-cert` before scanning again. `npm run verify` runs lint, tests, and an isolated end-to-end flow; stop manual app/lab processes first.

## Honest status

| Feature | Status | Evidence / limits |
|---|---|---|
| Config validation, login/session, CSRF, Helmet, login rate limiting | Done | Implemented and covered by Jest. |
| Scope checks, authorization confirmation, nonce proof | Done | Checked at creation and scan time; proof is HTTP without redirects. |
| Real TCP, HTTP, and TLS probes | Done | Real local-server tests and end-to-end lab check. |
| Snapshots, baseline, diff, alert log | Done | Unit fixtures and end-to-end port/certificate change checks. |
| Overview, Inventory, Changes, Audit, How it works | Done | Authenticated EJS pages, escaped data, external CSS, strict self-only CSP. |
| Loopback lab and automated verification | Done | `npm run lab`, control scripts, and `npm run verify`. |
| Email alerts, scheduled rescans, export | Planned | Not implemented; alerts currently go to application logs. |
| Distributed scan locking | Planned | Current lock is process-local; there is no multi-instance coordination. |

For the timed demo, see [DEMO-SCRIPT.md](DEMO-SCRIPT.md). More detail is in [ARCHITECTURE.md](ARCHITECTURE.md) and [SECURITY.md](SECURITY.md).
