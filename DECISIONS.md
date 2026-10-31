# Decisions

## 2026-10-10 — Phase 1 problem analysis (approved)

- Product: authorized attack-surface inventory + change monitor (discovery and monitoring only; no exploitation).
- Official problem: AIORI-3 **PS-011** — Authorised Attack-Surface Inventory and Change Monitor (Cybersecurity track).
- Primary user: SOC / security analyst.
- Stack: Node.js + MongoDB + simple web dashboard + Docker Compose lab.
- Demo: owned Docker lab only; no public domain. Authorization = confirmed allowlist + optional lab proof file; scanner refuses out-of-scope targets in code.
- **DNS/IP pinning (Must):** resolve hostnames; verify **every** resolved IP against the *hard outer boundary* (`SCOPE_CIDRS`) *and* the per‑target allowlist; connect **only** to those verified IPs (never connect by unpinned hostname). Re‑check on every scan job. Unit‑test the reject path with no connect.
- **Scope relationship:** `SCOPE_CIDRS` (env) defines a *global* outer boundary that no target may escape; each Target’s effective scope is the intersection of this outer boundary with any target‑specific CIDR entries (to be added later). This guarantees the tool can never be mis‑configured to scan the public Internet.
- Alerts: in-app + email (Mailhog in lab).
- AuthN: single admin from environment variables.
- Discovery: in-scope hosts, rate-limited TCP on a **configured port list**, HTTP/TLS facts. Tech fingerprinting not committed. Demo does not run ports 1–65535.
- Team: **2 students**, ~**36 useful hours**, sprint end **14 Oct 2026 end of day** (same day as AIORI Level 1). Faculty mentor is required by AIORI team rules but is not a coding seat. Team code `A3-PS011-TCxxx` not pasted yet.
- Organizers: presentation **must** follow `Proposed-structure-hackathon.pdf`. Online Level 1 process (fork, rename, collaborator, ownership transfer, PDF, intro video) is due **14 Oct 2026**. Code + working demo are later Level 2 steps (through **31 Oct 2026**). AIORI-3 guidebook PDF was not in the attachment set; scoring uses published AIORI-3 guidelines plus AIORI-2 rubric as a proxy, labelled as such.

## 2026-10-10 — Phase 2 requirements

- Written in [docs/PHASE2-REQUIREMENTS.md](docs/PHASE2-REQUIREMENTS.md). Phase 1 narrative lives in [docs/PHASE1-PROBLEM-ANALYSIS.md](docs/PHASE1-PROBLEM-ANALYSIS.md).
- MoSCoW locked for 2 people / ~36h ending 14 Oct 2026 EOD; DNS/IP pinning is Must with mocked unit tests.
- Organizer Must: 11-section PDF, RFC review, Level 1 GitHub/video by 14 Oct 2026.
- Should: Mailhog email, proof file, cron, JSON export.
- Won't: exploits, third-party scans, IMN live integration, full-port demo.
- No application code until Phase 5 (after design and task plan).

## 2026-10-10 — Phase 3 design (draft)

- Architecture: Express API + MongoDB + Scanner Service (Resolver + Rate-limited TCP/TLS) + Snapshot Diff + Cron + Dashboard + Mailhog + Audit Log.
- DNS/IP pinning in Resolver: resolve A/AAAA; every IP must be in allowlist; reject whole target if any IP is out-of-scope; connect only to verified IPs with SNI/Host header.
- Data model: targets, allowlist (IP/CIDR), snapshots, changes, audit collections.
- API: REST endpoints for targets, scans, snapshots, changes, allowlist, dashboard; admin token via env.
- Diff algorithm: O(N) comparison of latest vs previous snapshot; emits port_opened, port_closed, cert_changed, cert_expiring, host_added, host_removed.
- Threat model: fail-closed philosophy; admin-only mutations; DNS pinning mitigates rebinding; rate limits prevent DoS; append-only audit; no eval of external data.

## 2026-10-28 — Phase 4 planning (draft)

- Repo layout: `src/` (server), `src/scanner/`, `src/models/`, `src/routes/`, `src/utils/`, `tests/`, `docker/`, `docs/`.
- Branching: `main` (stable), feature branches `feat/<scope>`, PR workflow with review, squash‑merge, CI lint.
- Commit convention: Conventional Commits, ending with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Milestones: M1 (skeleton + allowlist), M2 (resolver + pinning unit tests), M3 (scanner & snapshot), M4 (diff & alerts), M5 (dashboard & email), M6 (final polish & presentation).
- Tasks split between Person A (backend, scanner, diff) and Person B (lab Docker, dashboard, email, docs).

- Architecture: Express API + MongoDB + Scanner Service (Resolver + Rate-limited TCP/TLS) + Snapshot Diff + Cron + Dashboard + Mailhog + Audit Log.
- DNS/IP pinning in Resolver: resolve A/AAAA; every IP must be in allowlist; reject whole target if any IP is out-of-scope; connect only to verified IPs with SNI/Host header.
- Data model: targets, allowlist (IP/CIDR), snapshots, changes, audit collections.
- API: REST endpoints for targets, scans, snapshots, changes, allowlist, dashboard; admin token via env.
- Diff algorithm: O(N) comparison of latest vs previous snapshot; emits port_opened, port_closed, cert_changed, cert_expiring, host_added, host_removed.
- Threat model: fail-closed philosophy; admin-only mutations; DNS pinning mitigates rebinding; rate limits prevent DoS; append-only audit; no eval of external data.
