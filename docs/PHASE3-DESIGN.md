# Phase 3 — Design

**Status:** Revised per feedback (ready for review)

---

## Architecture Diagram (Mermaid)

```mermaid
flowchart LR
    subgraph Operator
        O[Operator (admin via session cookie)]
    end
    subgraph API
        A[REST API (Express + Helmet)]
        Auth[Auth Middleware]
    end
    subgraph Scanner
        S[Scanner Service]
        R[Resolver (DNS/IP pinning)]
        C[Rate‑limited TCP/TLS Scanner]
        Lock[Scan Lock (per target)]
    end
    subgraph Storage
        DB[MongoDB]
        A --> DB
    end
    subgraph Scheduler
        CR[Cron / Re‑scan Scheduler]
    end
    subgraph Diff
        D[Snapshot Diff Engine]
    end
    subgraph Alerts
        UI[Dashboard (EJS + HTMX)]
        EM[Mailhog Emailer]
    end
    subgraph Audit
        LG[Audit Log (insert-only role)]
    end
    O --> A
    Auth --> A
    A --> S
    S --> Lock
    Lock --> R
    R --> C
    C --> DB
    CR --> S
    DB --> D
    D --> UI
    D --> EM
    S --> LG
    A --> LG
    UI --> LG
```

---

## Components

| Component | Responsibility |
|---|---|
| **Operator (admin)** | Logs in via form; session cookie; constant‑time credential compare; all routes protected except `/health`. |
| **REST API (Express + Helmet)** | CRUD for targets, authorization confirm/verify, async scan with status, snapshots, changes, allowlist, dashboard, global change feed. |
| **Auth Middleware** | Session cookie validation; CSRF protection (double‑submit cookie); blocks unauthenticated requests. |
| **Resolver** | Resolves A/AAAA (via `dns.promises`); verifies **every** resolved IP against the single source‑of‑truth scope (IP/CIDR allowlist); rejects whole target if any IP is out‑of‑scope; handles CNAME chains; private ranges (RFC 1918/6890) and IPv6 supported; no DNSSEC assumption. |
| **Scanner Service** | Acquires per‑target lock; rate‑limited TCP/TLS connect **only to pinned IPs** (no redirects, SNI carries original hostname); banner grab; TLS cert extraction (subject, SAN, notAfter, fingerprint); fails closed if pinning fails. |
| **Scan Lock** | Prevents concurrent scans of the same target (in‑memory mutex + TTL; Redis not required for demo). |
| **MongoDB** | Persists `targets`, `scope` (IP/CIDR), `snapshots`, `changes`, `audit`. Insert‑only DB role for audit collection. |
| **Snapshot Diff Engine** | Compares latest successful snapshot vs previous; first scan = baseline; failed/partial scans never diffed; host added/removed by IP; emits `port_opened`, `port_closed`, `banner_changed`, `cert_changed`, `cert_expiring` (deduplicated per target), `host_added`, `host_removed`; change records reference `snapshotId` and `previousSnapshotId`. |
| **Cron Scheduler** | Triggers periodic re‑scan jobs for **confirmed & proof‑verified** targets only; respects scan lock. |
| **Dashboard** | Server‑side rendered EJS + HTMX; shows current inventory, per‑target change history, global change feed; seeded data for demo. |
| **Mailhog Emailer** | Sends plain‑text change alerts; falls back to log if SMTP unavailable. |
| **Audit Log** | Insert‑only collection (enforced by DB role) capturing: `scan_allowed`, `scan_denied`, `target_added`, `target_removed`, `auth_confirmed`, `proof_verified`, `scan_start`, `scan_end`, `scan_error`, `config_change`, `login`, `logout`. Includes target ID, resolved IPs, actor, timestamp, message. |

---

## Data Model (MongoDB Collections)

```json
// targets
{
  "_id": ObjectId,
  "hostname": "web.lab",          // optional if ip provided
  "ip": "10.10.0.5",              // optional if hostname provided
  "status": "pending" | "confirmed" | "proof_verified" | "disabled",
  "confirmedBy": "operator",
  "confirmedAt": ISODate,
  "proofNonce": "random-string",  // set at confirm time
  "proofVerifiedAt": ISODate,     // set when proof file check passes
  "createdAt": ISODate,
  "updatedAt": ISODate
}

// scope (single source of truth: IP / CIDR only)
{
  "_id": ObjectId,
  "type": "ip" | "cidr",
  "value": "10.10.0.5" | "10.10.0.0/24",
  "sourceTargetId": ObjectId,
  "createdAt": ISODate
}

// snapshots (only successful, complete scans)
{
  "_id": ObjectId,
  "targetId": ObjectId,
  "ip": "10.10.0.5",
  "ports": [
    { "port": 80, "state": "open", "banner": "nginx", "service": "http" },
    { "port": 443, "state": "open", "banner": "", "service": "https" }
  ],
  "tls": { "certFingerprint": "ab:cd...", "notAfter": ISODate, "subject": "CN=lab", "sans": ["lab"] },
  "scannedAt": ISODate,
  "scanDurationMs": 1234
}

// changes (diff events)
{
  "_id": ObjectId,
  "targetId": ObjectId,
  "snapshotId": ObjectId,
  "previousSnapshotId": ObjectId | null,
  "type": "port_opened" | "port_closed" | "banner_changed" | "cert_changed" | "cert_expiring" | "host_added" | "host_removed",
  "details": { /* varies per type */ },
  "detectedAt": ISODate
}

// audit (insert-only; DB role prevents update/delete)
{
  "_id": ObjectId,
  "event": "scan_allowed" | "scan_denied" | "target_added" | "target_removed" | "auth_confirmed" | "proof_verified" | "scan_start" | "scan_end" | "scan_error" | "config_change" | "login" | "logout",
  "targetId": ObjectId?,
  "ipList": ["10.10.0.5", "2001:db8::1"],
  "actor": "operator",
  "timestamp": ISODate,
  "message": "..."
}
```

---

## API Endpoints (Express, JSON)

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Public health check (no auth). |
| `GET` | `/login` | Login form (CSRF token in page). |
| `POST` | `/login` | Validate credentials (constant‑time compare); set `HttpOnly; Secure; SameSite=Strict` session cookie. |
| `POST` | `/logout` | Destroy session; clear cookie. |
| `POST` | `/api/targets` | Add target (hostname and/or IP/CIDR); status=`pending`. |
| `GET` | `/api/targets` | List all targets with status. |
| `DELETE` | `/api/targets/:id` | Remove target; audit logged. |
| `POST` | `/api/targets/:id/confirm` | Confirm authorization: sets `confirmedBy`, `confirmedAt`, generates `proofNonce`; status=`confirmed`. |
| `POST` | `/api/targets/:id/verify-proof` | Fetch `/.well-known/<proofNonce>` from target; on match sets `proofVerifiedAt`, status=`proof_verified`. |
| `POST` | `/api/scan/:id` | Async scan: validates target is `proof_verified`; acquires lock; returns `{ jobId, status: "queued" }`. |
| `GET` | `/api/scan/:jobId/status` | Poll scan job status (`queued` | `running` | `completed` | `failed`). |
| `GET` | `/api/snapshots/:targetId` | Retrieve snapshot history for a target. |
| `GET` | `/api/changes/:targetId` | Get change events for a target. |
| `GET` | `/api/changes` | Global change feed (all targets, paginated). |
| `GET` | `/api/allowlist` | Inspect raw scope entries (IP/CIDR). |
| `GET` | `/dashboard` | HTML view (EJS) of current inventory + global change feed. |

All mutating routes (except `/login`, `/logout`) require authenticated session + valid CSRF token.

---

## Change Detection (Snapshot Diff)

**Preconditions**
- Only **successful, complete** scans produce snapshots. Failed or partial scans are logged to audit but **never** enter the diff pipeline.
- First successful scan for a target → baseline (no changes emitted).

**Algorithm** (O(N) where N = configured ports per host)
1. Fetch latest snapshot (`snapshots.findOne({ targetId }).sort({ scannedAt: -1 })`).
2. Fetch previous snapshot for same target (`sort({ scannedAt: -1 }).skip(1)`).
3. If no previous → baseline, return.
4. Compare by **resolved IP** (host added/removed).
5. For each IP present in both:
   - Ports: compare by port number; detect `open` ↔ `closed` transitions → `port_opened` / `port_closed`.
   - Banners: if `banner` or `service` string differs → `banner_changed`.
   - TLS: if `certFingerprint` differs → `cert_changed`.
   - Expiry: if `notAfter` within `EXPIRY_THRESHOLD_DAYS` and no prior `cert_expiring` for this fingerprint → `cert_expiring` (deduplicated).
6. Persist each change with `snapshotId` (new) and `previousSnapshotId` (old).
7. Push to in‑app feed + emailer.

---

## Threat Model (Our Tool)

| Asset | Potential Threat | Mitigation |
|---|---|---|
| **Scope / Allowlist** | Unauthorized modification → scanning out‑of‑scope. | Admin‑only API; session + CSRF; audit log with insert‑only DB role; no env‑only secret for API. |
| **DNS Resolver** | DNS poisoning / rebinding → IP pinning bypass. | Resolve via `dns.promises`; verify **every** A/AAAA against scope (IP/CIDR); follow CNAME chain fully; reject if **any** resolved IP is out‑of‑scope; private ranges (RFC 1918/6890) and IPv6 treated identically; no DNSSEC dependency. |
| **Scanner Connections** | Connecting to unpinned IP / following redirects. | **Pinned‑IP connect only**: create socket to verified IP, set SNI/Host header to original hostname; disable HTTP redirects (`maxRedirects: 0`); TLS `checkServerIdentity` verifies cert matches expected hostname. |
| **Scanner DoS** | Excessive sockets / unbounded scans. | Configurable `MAX_CONCURRENT_SOCKETS`, `INTER_PORT_DELAY_MS`; per‑target scan lock (mutex + TTL); default port list small; cron respects lock. |
| **MongoDB** | Data tampering / audit trail loss. | Audit collection uses insert‑only DB role; write‑concern `majority`; Docker volume snapshots for backup. |
| **Dashboard** | XSS via stored banners / cert fields. | Helmet CSP; EJS auto‑escapes; HTMX `hx-swap` sanitized; no `eval`/`innerHTML` with user data. |
| **Dashboard** | NoSQL injection via query params. | `zod` validation on all inputs; Mongoose strict schemas; no raw query objects from user input. |
| **Dashboard** | CSRF on state‑changing forms. | Double‑submit cookie pattern; `SameSite=Strict` session cookie; CSRF token required on all POST/PUT/DELETE. |
| **Email Alerts** | Spam / info leakage. | Mailhog in isolated Docker network; email contains only change metadata (no banners, certs). |
| **Scheduler** | Unbounded re‑scan frequency. | Configurable interval + minimum back‑off; scan lock prevents overlap. |

Overall philosophy: **fail‑closed** — if any verification step cannot be performed safely, the scan is aborted and the event is audited. No packets leave the process toward non‑allowlisted IPs.

---

## Next Steps

- Finalise OpenAPI spec (can be generated from route definitions).
- Implement resolver with strict IP pinning using `dns.promises`.
- Scaffold Express + Helmet + session + CSRF + `zod` validation.
- Write unit tests for resolver (mocked DNS, extra A/AAAA records, CNAME chains, IPv6, private ranges).
- Set up Docker Compose lab (Mongo, app, Mailhog, dummy HTTP/HTTPS with swappable cert, nginx with `/.well-known/<nonce>`).