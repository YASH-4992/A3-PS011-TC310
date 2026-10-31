# Five-minute demo script

**Prerequisites:** MongoDB is running; `.env` uses a demo-only admin password, `SCOPE_CIDRS=127.0.0.1/32`, `SCAN_PORTS=8080,8443,9100`, `PROOF_HTTP_PORT=8080`, and `REQUIRE_PROOF_BEFORE_SCAN=true`. Have the app and lab ready on loopback before starting the timer.

| Time | Demo action |
|---|---|
| 0:00–0:35 | State the legal boundary: authorized systems only, discovery only, and empty scope means no scans. Show `.env` scope set to `127.0.0.1/32`. |
| 0:35–1:10 | Open `http://127.0.0.1:3000/login`; sign in. Point out that the dashboard is behind authentication and uses CSRF-protected forms. |
| 1:10–1:45 | Add `127.0.0.1` as hostname and IP. Check the authorization acknowledgement. Show that the Inventory displays a target in `pending` state and a proof nonce. |
| 1:45–2:20 | Select **Confirm** and check its authorization box. In PowerShell, run `Set-Content -NoNewline .\.lab-data\proof.txt '<nonce>'`; select **Verify proof**. Show the proof-verified state. |
| 2:20–3:05 | Select **Scan now**. Refresh Inventory after the scan; point out the real HTTP/HTTPS ports, HTTP service facts, TLS certificate expiry, and successful scan audit events. This first scan is the baseline. |
| 3:05–3:45 | In PowerShell run `npm run lab:open-port` and `npm run lab:swap-cert`. Explain that these modify only the loopback demo service. |
| 3:45–4:25 | Scan the target again. Open **Changes** and show `port_opened` and `cert_changed`, each linked to the current and previous snapshots. |
| 4:25–5:00 | Return to Inventory and attempt to add `8.8.8.8` as a target. Show the clear out-of-scope rejection and the corresponding audit event; explain that the server rejects it before any probe. |

End by noting that email delivery, scheduled rescans, and export are planned, not implemented. Avoid scanning any address other than the explicitly authorized loopback lab during this demo.
