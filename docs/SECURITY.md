# Security notes and threat model

## Intended use and trust boundaries

This application is for an operator who owns or has explicit permission to inventory the configured targets. `SCOPE_CIDRS` is the hard address boundary; it is not proof of legal authorization. The operator must also confirm authorization, and by default the target must return a nonce proof file before scanning. The app should be run on a trusted host with protected MongoDB credentials and a narrowly configured scope.

## Threats and mitigations

| What could go wrong | Current mitigation |
|---|---|
| Operator enters an out-of-scope address | Target creation checks scope and records the denial. Scan logic rechecks scope before probes. Empty scope allows no target address. |
| Hostname resolves to an unexpected or mixed-scope address | All DNS results are checked; a result outside scope rejects the scan. Connections use the validated numeric IPs rather than a second implicit DNS lookup. |
| Target was added without owner permission | Authorization acknowledgement and a separate confirmation are required. A nonce proof check is also required by default. These checks support, but cannot independently establish, legal permission. |
| A web request triggers an unintended state change | Session authentication, CSRF tokens, Zod validation, Helmet headers, and login rate limiting are applied. |
| Scan traffic overwhelms a service | Ports are server-configured, with bounded concurrency, delays, connection timeouts, and response size limits. Probes do not follow redirects or perform writes. |
| Scan starts while the audit store is unavailable | The scan route writes `scan_started` before launching the scan and refuses when that write fails. |
| User-supplied values become script markup | EJS output uses escaped interpolation; the CSP permits scripts/styles only from the same origin. |
| Audit events are edited through the application | Application code exposes audit insertion and reading only; there is no audit mutation route. Database administrators can still alter database contents. |
| Concurrent scans overlap | A per-target in-memory lock prevents overlaps within one running process. |

## Known limitations

- The scan lock is in-memory and does not coordinate multiple application instances.
- There is one configured administrator account, not a user/role management system.
- The lab is a local Node script intended for loopback demonstration; it is not a production target environment.
- Proof verification uses an HTTP well-known file and proves possession of a nonce response, not legal authorization or ownership by itself.
- Audit immutability is enforced at the application/API layer, not by a separately secured append-only database service.
- Email alert delivery, scheduled rescans, export, and distributed locking are planned, not implemented.
- This is a hackathon/demo implementation; it has not been independently penetration-tested or certified for production.

## Safe operation

Use the narrowest `SCOPE_CIDRS`, keep admin/session secrets out of source control, protect the MongoDB service, and run the tool only on systems for which you have explicit authorization. The local demo uses `127.0.0.1/32` and should remain loopback-only.
