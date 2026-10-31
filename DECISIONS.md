# Decisions

## Current implementation decisions — 2026-10-31

- **Product boundary:** AIORI-3 PS-011 authorized attack-surface inventory and change monitoring. Discovery only; no exploitation, brute force, or fuzzing.
- **Fail closed:** `SCOPE_CIDRS` is the hard outer boundary. An empty value authorizes no network probes. Creation and scan-time checks are both required.
- **DNS pinning:** resolve hostnames at scan time, reject the target if any answer is out of scope, and connect only to validated numeric addresses.
- **Authorization:** the operator acknowledges authorization while adding a target, then explicitly confirms it; proof verification is required by default before scanning.
- **Ports and probes:** ports come from server configuration/code, not a request. The scanner uses short timeouts, bounded concurrency and banner size, and a per-target process-local lock. Discovery records only TCP banners, light HTTP facts, and TLS certificate facts.
- **Audit:** privileged actions are written through the insert-only audit service. The dashboard/API expose reads only; there is no audit update/delete route.
- **Lab:** use a Node loopback lab rather than Docker. It runs HTTP on 8080, HTTPS on 8443, the proof file endpoint, and an optional TCP port on 9100. OpenSSL creates a self-signed certificate in ignored `.lab-data`.
- **Data and alerts:** successful scans create snapshots; first successful scan is the baseline. Later successful snapshots are compared by a pure diff engine, persisted as changes, and logged as plain-text alerts. Email delivery is not implemented.
- **Verification:** Jest uses the separate `aiori_test` database. `npm run verify` runs lint/tests and starts the lab and app against a unique verification database.
- **Stack:** Node.js 20+, ES modules, Express, EJS, MongoDB/Mongoose, Zod, Helmet, Pino, ipaddr.js, Jest, and Supertest.

## Historical planning context

The initial planning documents considered Docker Compose, per-target CIDR allowlists, email alerts, scheduling, and JSON export. The current build instead uses a single `SCOPE_CIDRS` outer boundary, a Node-only local lab, and application-log alerts. Per-target CIDR allowlists, email, scheduled scans, export, distributed locks, and production deployment remain **Planned**; do not describe them as implemented.
