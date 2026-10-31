# Five-minute evaluator demo

## Before the timer

Start MongoDB. Configure `.env` with a demo-only admin password, a unique session secret, `SCOPE_CIDRS=127.0.0.1/32`, `SCAN_PORTS=8080,8443,9100`, `PROOF_HTTP_PORT=8080`, and `REQUIRE_PROOF_BEFORE_SCAN=true`. In separate terminals start `npm run lab` and `npm start`. Do not use any target other than the loopback lab.

| Time | Click path and talking points |
|---|---|
| 0:00–0:35 | Open `http://localhost:3000/login` and sign in. Explain that only a configured administrator can enter and that this tool is for authorized discovery, not exploitation. |
| 0:35–1:00 | On **Overview**, show the live counters, Getting started checklist, and scope panel. Point to `127.0.0.1/32` and the rule that out-of-scope addresses are blocked and logged. |
| 1:00–1:35 | Open **Inventory**. Add hostname/IP `127.0.0.1`, choose a label, and check the authorization acknowledgement. Show that this action alone does not scan. |
| 1:35–2:10 | On the new target card, select **Confirm authorization** and check its confirmation box. Copy the displayed nonce into the local lab with `Set-Content -NoNewline .\\.lab-data\\proof.txt '<nonce>'`; select **Verify proof**. |
| 2:10–2:55 | Select **Scan now** and refresh Inventory. Show the real open configured ports, service facts, TLS certificate expiry, and the first-scan baseline. |
| 2:55–3:35 | In PowerShell, run `npm run lab:open-port` and `npm run lab:swap-cert`. Explain that both affect only the loopback demo service. Scan again and refresh Inventory. |
| 3:35–4:10 | Open **Changes**. Point out the newly opened port and changed certificate, the severity badges, and the fact that records reference the two compared snapshots. |
| 4:10–4:35 | Open **Audit**. Show the allowed actions recorded so far and explain this is a read-only application view. |
| 4:35–5:00 | Return to **Inventory** and attempt to add hostname/IP `203.0.113.10` with the authorization box checked. The action is rejected: it is outside `127.0.0.1/32`, nothing was sent, and the attempt is in Audit. |

Conclude by distinguishing the implemented application-log alerts from planned email, scheduled scans, export, and distributed locking.
