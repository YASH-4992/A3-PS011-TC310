# AIORI PS-011 — Authorized Surface Monitor

An operator-controlled inventory and change monitor for systems the operator is explicitly authorized to scan. It records reachable configured TCP ports, short service banners, light HTTP facts, and TLS certificate details, then compares successful snapshots and logs alerts.

> **Legal use:** Scan only systems you own or are explicitly authorized to test. This is a discovery and monitoring tool only: it does not exploit, brute-force, or fuzz targets. An empty `SCOPE_CIDRS` fails closed and permits no scan.

## Windows setup

Requirements: Windows PowerShell, Node.js 20+, MongoDB running locally, Git for Windows (provides OpenSSL for the lab certificate), and npm.

```powershell
git clone <repository-url>
Set-Location .\A3-PS011-TC310
npm ci
Copy-Item .env.example .env
```

Edit `.env` before starting the application:

- Set `ADMIN_USERNAME` and a strong `ADMIN_PASSWORD`.
- Set `SESSION_SECRET` to a unique random value of at least 16 characters.
- Set `SCOPE_CIDRS=127.0.0.1/32` for the local demo.
- Set `SCAN_PORTS=8080,8443,9100` for the local demo.
- Set `PROOF_HTTP_PORT=8080` for the local demo.
- Keep `REQUIRE_PROOF_BEFORE_SCAN=true`.

The `.env` file is ignored by Git. Do not commit credentials.

## Run the local demo

Open two PowerShell terminals from the repository directory:

```powershell
# Terminal 1: HTTP/HTTPS target servers and proof-file endpoint on loopback.
npm run lab
```

```powershell
# Terminal 2: application. MongoDB must already be running.
npm start
```

To run automated verification instead, stop the manual lab and app, then run `npm run verify`; it starts its own instances.

Visit `http://127.0.0.1:3000/login` and sign in with the credentials from `.env`. Add `127.0.0.1` as both hostname and IP, and check the authorization box. On Inventory, confirm authorization and note the proof nonce. Put that exact nonce into `.lab-data\proof.txt`:

```powershell
Set-Content -NoNewline .\.lab-data\proof.txt '<nonce-shown-on-inventory>'
```

Select **Verify proof**, then **Scan now**. For a change demonstration, run `npm run lab:open-port` and `npm run lab:swap-cert`, then scan again. The Changes page should show `port_opened` and `cert_changed`.

## Five-minute demo

Follow [docs/DEMO-SCRIPT.md](docs/DEMO-SCRIPT.md) for a timed, reproducible sequence.

## Architecture

- **Express + EJS**: session-authenticated dashboard and API; CSRF tokens on state-changing forms and requests; Helmet CSP; login rate limiting.
- **MongoDB/Mongoose**: targets, scan jobs, immutable snapshots, changes, and insert-only audit events.
- **Scope/resolver**: target IP checked against `SCOPE_CIDRS` at creation and again before scanning; hostnames are resolved at scan time and every resulting address is checked before any probe. Probes connect to numeric pinned addresses.
- **Scanner**: only server-configured ports; bounded concurrency, delays, timeouts, and banner size. TCP banner, HTTP status/Server/title, and TLS certificate facts are collected without redirects or write operations.
- **Diff and alerts**: first successful snapshot is the baseline. Later snapshots are compared by host and port; change documents reference both snapshots and each change is logged as a plain-text alert.
- **Lab**: a local Node script serves HTTP on 8080, HTTPS on 8443, proof content on the HTTP server, and an optional TCP service on 9100. OpenSSL creates a self-signed certificate under ignored `.lab-data\`.

## Status

| Area | Status | Notes |
|---|---|---|
| Login, sessions, CSRF, Helmet, login rate limit | Done | Dashboard is protected; login and dashboard forms include CSRF tokens. |
| Target scope, authorization confirmation, proof | Done | Proof must match the target nonce; configured proof port supports the local lab. |
| Real scanning and scan locking | Done | Scope is rechecked at scan time; port list is server-side; tests use real ephemeral local servers. |
| Snapshot diff and change feed | Done | Baseline plus port/banner/certificate/host changes; failed scans are excluded. |
| Local HTTP/HTTPS/TCP lab | Done | `npm run lab`, `npm run lab:open-port`, and `npm run lab:swap-cert`. |
| Inventory, Changes, Audit pages | Done | Shared EJS layout; dynamic content is escaped. |
| Verification flow | Done | `npm run verify` runs lint, tests, and an isolated-database end-to-end demo. |
| Email alerts, scheduled rescans, export | Planned | Not implemented; alerts currently go to the application log. |
| Deployment hardening / multi-instance lock | Planned | The scan lock is in-memory and intended for the single-process demo. |

## Commands

```powershell
npm run lint
npm test
npm run verify
```

AI assistance: [to be filled by the team]
