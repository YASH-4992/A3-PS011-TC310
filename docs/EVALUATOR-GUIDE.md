# Evaluator guide

## What this project is

AIORI PS-011 is an authorized-only attack-surface inventory and change monitor. It checks a bounded, server-configured set of ports, saves successful observations, compares later results, and records operator actions. It is discovery only.

## What to inspect

| Page or file | What it demonstrates |
|---|---|
| Overview (`/dashboard`) | Real target/scan/change counts, setup progress, and the active scope boundary. |
| Inventory (`/dashboard/inventory`) | Authorization acknowledgement, explicit confirmation, proof verification, scan results, ports, service facts, and certificate expiry. |
| Changes (`/dashboard/changes`) | Baseline-aware stored differences from successful scans. |
| Audit (`/dashboard/audit`) | Read-only view of allowed and denied operator actions. |
| How it works (`/dashboard/how-it-works`) | Plain-language workflow, glossary, and explicit non-goals. |
| `src/routes/targets.js`, `src/routes/scans.js` | Scope, authorization, proof, audit-before-scan, and scan initiation gates. |
| `src/services/scanner.js`, `src/services/diffEngine.js`, `src/services/changeService.js` | Pinned discovery probes, pure snapshot comparison, and persisted alerts. |
| `src/services/auditService.js` | Audit write/read operations; no application update/delete API. |
| `scripts/lab.mjs`, `scripts/verify.mjs` | Loopback-only target simulator and repeatable end-to-end assertions. |

## Judging-style criteria

- **Problem fit:** inventory and change tracking for explicitly authorized systems, with clear operator workflows and audit events.
- **Security:** fail-closed scope, per-scan address checks and pinning, authorization/proof gate, request validation, CSRF, session auth, strict CSP, bounded probes, and audit-before-network behavior.
- **Working demo:** loopback HTTP/HTTPS/proof service, optional TCP port, certificate rotation, and `npm run verify`.
- **Code quality:** separated routes/services/models, pure diff engine, Jest tests, lint, and explicit error states.
- **Documentation:** setup, timed demo, evaluator notes, architecture, threat model, and a transparent Done/Planned list.

## Ten likely evaluator questions

1. **Can it scan an arbitrary public IP?** No. Only addresses covered by configured `SCOPE_CIDRS` are allowed; the sample demo scope is loopback only.
2. **What happens when scope is empty?** Nothing is in scope, so target creation/probing is blocked.
3. **How is authorization represented?** The operator acknowledges authorization during target creation and confirms it; the server records the operator and timestamp.
4. **What is the proof file for?** A target must serve a file containing its generated nonce at the expected well-known path before scanning, by default.
5. **What data does a scan collect?** Configured-port reachability, a bounded banner, light HTTP facts, and TLS certificate facts.
6. **Does it exploit services?** No. It is a discovery and monitoring tool, not an exploitation, brute-force, or fuzzing tool.
7. **How does it identify a change?** It compares a new successful snapshot to the previous successful snapshot; the first successful result is a baseline.
8. **What happens if a scan fails?** The job is marked failed; that result is not compared as a successful snapshot.
9. **Is audit storage tamper-proof?** The application exposes insert/read operations and no audit edit/delete route. Direct database administrators remain outside that application-level guarantee.
10. **What is not implemented?** Email delivery, scheduled rescans, export, and distributed scan locking are planned; the current lock is in-memory.
