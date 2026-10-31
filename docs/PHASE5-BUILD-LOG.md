# Phase 5 — Build log

Updated 2026-10-31. This log describes the implementation currently in the repository; older phase plans were replaced where they no longer matched the delivered application.

## Completed slices

| Slice | Implemented behavior | Validation |
|---|---|---|
| Configuration and authentication | Zod environment validation, Express sessions, login audit, CSRF, Helmet CSP, login rate limiting. | Unit tests; login flow in `npm run verify`. |
| Scope, authorization, proof, and audit | Target IP scope gate at creation; operator confirmation checkbox; nonce proof at a configurable HTTP port; insert-only audit writes and read-only route. | Scope/confirmation tests; proof flow in `npm run verify`. |
| Scanner and snapshots | Real TCP/TLS/HTTP discovery on configured server-side ports; pinned IPs, timeouts, concurrency/delay limits, per-target lock, persisted scan jobs/snapshots. | Real ephemeral TCP and HTTP server tests; lab scans in `npm run verify`. |
| Diff and alerts | Pure baseline-aware diff; port opened/closed, banner/certificate changes, host added/removed; snapshot references; plain-text log alert per saved change. | `tests/unit/diffEngine.test.js`; verified port and certificate changes. |
| Local lab and dashboard | HTTP/HTTPS/proof lab, optional extra TCP port, certificate rotation, shared escaped EJS layout and Inventory/Changes/Audit pages. | Dashboard route tests and E2E lab. |
| End-to-end verification | Isolated dynamic MongoDB database and assertions for login, target authorization, proof, scans, changes, out-of-scope refusal, and audit. | `npm run verify`. |

## Current commands

```powershell
npm run lint
npm test
npm run lab
npm run lab:open-port
npm run lab:swap-cert
npm run verify
```

`npm run verify` runs lint, the Jest suite, then the automated end-to-end verification. MongoDB must be running locally. Lab and app listeners bind to loopback.

## Planned, not implemented

- SMTP/email alert delivery; changes currently alert through application logs.
- Scheduler/cron rescans.
- Inventory/change export.
- Distributed locks and multi-instance production deployment.

No phase status above implies these planned items are complete.
