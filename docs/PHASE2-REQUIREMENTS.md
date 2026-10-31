# Phase 2 — Requirements

**Status:** Written 2026-10-10 for approval-as-implementation of the Phase 1 plan todo “requirements, user stories, MoSCoW.” No application code in this phase.

**Why this phase exists:** a shared Must/Should/Could/Won’t list is the contract. Tests, demo, and slides must argue the same product.

Problem: AIORI-3 **PS-011**. Team: 2 students, ~36 useful hours, sprint end **14 Oct 2026 EOD** (same day as Level 1 process).

---

## Organizer constraints folded in

**Read:** Proposed-structure-hackathon.pdf (11 slides). **Public:** AIORI-3 Online Hackathon Guidelines. **Proxy (labelled, not official AIORI-3 scores):** AIORI-2 guidebook.

| Source | Requirement impact |
| --- | --- |
| Team edit | Hostname resolve → every IP on allowlist → connect only to verified IPs; unit tests; Must |
| Structure PDF | Slide deck is a Must: Abstract, Background, Literature & RFC Review, Proposed Solution, Optimization before/after table, Architecture UML, DFD, Deployment Timeline, Bibliography. Title uses `A3-PSxxx-TCxxx` |
| AIORI-3 guideline | Level 1 due **14 Oct 2026** or elimination: fork template, rename to team code, add `aiori-hackathon`, transfer ownership, upload structured PDF, YouTube intro, link on GitHub. Level 2 (16–31 Oct): mentoring, code, working demo |
| Portal | PS-011; team = 2 students + faculty mentor |
| AIORI-2 proxy | Unit tests + reproducible README scored; JSON export as Should for “integration readiness”; RFC citations on Literature slide; incremental git commits |

Team code `A3-PS011-TCxxx` not pasted yet.

---

## Functional requirements

**FR1 Scope allowlist.** Store targets (hostname and/or IP, optional CIDR for lab net). Empty allowlist ⇒ no scan jobs start.

**FR2 Authorization confirmation.** Enabling a target requires explicit operator confirm (who, when). Optional lab proof file is Should.

**FR3 Fail-closed scanner (Must).** For every scan job:

1. Load confirmed allowlist.
2. If target is an IP: allow only if that IP is on the list (or in an allowed CIDR).
3. If target is a hostname: resolve A/AAAA; **every** address must be allowlisted; if any address is outside, **reject the whole target**.
4. Open TCP/TLS **only** to verified IP(s). For HTTPS, connect to the IP and send SNI/Host of the original name. Do not connect by unpinned hostname.
5. Re-resolve and re-verify at job start.
6. Denied attempts write an audit row and **must not** create a socket to a non-allowlisted IP.

**FR4 Discovery.** Rate-limited TCP to a **configured port list**; record open/closed/timeout; cheap banner if free; TLS cert subject, SAN, notAfter, fingerprint when the port speaks TLS.

**FR5 Snapshots.** Each successful scan stores a full inventory snapshot.

**FR6 Change detection.** Diff last snapshot vs new: new/removed host, new/closed port, cert fingerprint change, cert expiry within N days (config). Persist change events.

**FR7 Scheduled re-scan.** Interval over confirmed targets only (Should if Day 2 slips).

**FR8 Alerts.** Dashboard change list (Must) + plain-text email via Mailhog (Should). If SMTP is down, log the alert payload.

**FR9 Audit log.** Append-only: allow, deny, scan start/end, errors, operator confirm. Include target, resolved IPs, actor.

**FR10 Operator login.** Single admin from env vars.

**FR11 Lab.** Compose: MongoDB, app, Mailhog, dummy HTTP, HTTPS with replaceable cert, a port that can be opened mid-demo.

**FR12 Export (Should).** JSON dump of latest inventory + changes.

---

## Non-functional requirements

- **Safety:** no packets to non-allowlisted IPs; default config scans nothing; no exploit modules.
- **Gentleness:** max concurrent sockets and inter-port delay from env; small default port list.
- **Testability:** allowlist + DNS pinning tests inject a fake resolver and assert `connect` is never called.
- **Config:** secrets and SMTP only via env; `.env.example` committed.
- **Repro:** Docker Compose + README.
- **Observability:** consistent logs for scan/deny.
- **UI:** Express templates or one static page; no React SPA in the 36-hour Must list.
- **Process:** AIORI PDF structure; incremental commits.

---

## User stories and acceptance criteria

**US1 — Confirm scope.** As operator, I add `web.lab` / `10.10.0.5` and confirm authorization.  
AC: stored with actor+time; not scannable until confirmed.

**US2 — Reject out of scope.** As operator, I type `example.com` or `8.8.8.8` when allowlist is only `172.20.0.0/16`.  
AC: API 4xx; audit `denied`; **zero** connect/TLS attempts (mocked unit test).

**US3 — DNS pinning.** Hostname in scope resolves to `{allowlisted IP, 8.8.8.8}`.  
AC: scan aborted; no connect to either IP; audit lists resolved addresses. Hostname with only allowlisted IPs: connect only those IPs.

**US4 — Baseline inventory.** Scan confirmed lab HTTP/HTTPS.  
AC: snapshot lists host, verified IPs, open ports from the configured list, TLS fields on TLS ports.

**US5 — Change: new port.** Open a lab port and re-scan.  
AC: change event `port_opened` on dashboard.

**US6 — Change: certificate.** Replace lab TLS cert and re-scan.  
AC: `cert_changed` (fingerprint); expiry warning if `notAfter` within threshold.

**US7 — Email.** On new change event.  
AC: Mailhog shows plain text, or logs contain the same body if SMTP failed.

**US8 — Schedule.** Interval elapsed.  
AC: only confirmed allowlisted targets queued; each job repeats FR3.

**US9 — Login.** Unauthenticated dashboard/API request.  
AC: redirect or 401; env admin can log in.

**US10 — Demo block.** Add unauthorized target live.  
AC: visible deny; audit; no outbound connect.

**US11 — Slides/process.**  
AC: PDF has all template sections; RFC list non-empty; GitHub steps 1–7 by 14 Oct 2026.

---

## MoSCoW

### Must

- Allowlist + explicit authorization confirm; fail closed.
- Resolve hostnames; verify every IP; connect only to verified IPs; re-verify each job; unit tests with mocked DNS/connect.
- Rate-limited scan of configured ports; TLS cert facts; snapshots; diff (port + cert + new host).
- In-app changes; audit log; admin login; env config; Docker lab for the demo story.
- README + `.env.example`; default = scan nothing.
- AIORI presentation PDF (11 sections) + RFC bibliography (first draft by Level 1).
- Level 1 GitHub/video steps by **14 Oct 2026**.

### Should

- Email via Mailhog (plain text).
- Lab proof file on nginx.
- Cron re-scan.
- Inventory/changes JSON export.
- Cert “expires in N days” as its own event type.
- Structured logs.

### Could

- Wider port range behind a flag (still rate-limited).
- HTTP proof-file automation beyond a static file.
- Pretty charts, tech fingerprinting, subdomain CT logs.
- Real cloud SMTP.

### Won’t

- Exploitation, brute force, CVE scoring, scanning third-party internet, cloud APIs, multi-tenant SSO, 65535-port demo, React SPA, live AIORI IMN integration.

---

## RFCs the slides must name (only what we implement)

- RFC 1035 / 3596 — DNS A/AAAA
- RFC 1918 / 6890 — private/lab addressing in allowlist
- RFC 5280 — certificates inventoried
- RFC 8446 — TLS (how we obtain certs)
- RFC 9110 — HTTP
- RFC 5785 — `/.well-known/` if we ship a proof file
- RFC 8259 — JSON export
- Engineering story: unexpected extra A/AAAA records (DNS pinning / rebinding-class failure)

---

## Next phase (not started here)

Phase 3: architecture, data model, API endpoints, snapshot-diff algorithm, threat model of **this** tool. No application code until Phase 5.
