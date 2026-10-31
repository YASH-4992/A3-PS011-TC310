import logger from '../utils/logger.js';
import config from '../config/index.js';

/**
 * Proof verification service.
 *
 * It fetches `http://<ip>/.well-known/as-inventory-auth.txt` (or HTTPS if the
 * caller passes a URL with `https:`) and compares the body to the stored nonce.
 *
 * The function respects a configurable timeout (`PROOF_HTTP_TIMEOUT_MS`).
 * If the fetch times out or the HTTP status is not 200, the result is `false`.
 *
 * This service is **pure** – it never writes to the DB. The API route will
 * record the outcome via `auditService.logEvent`.
 *
 * SYNTAX: Node 22+ has global `fetch` – no import needed.
 */
export const verifyProof = async ({ ip, nonce, timeoutMs = 3000, port = config.proof.httpPort }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const host = ip.includes(':') ? `[${ip}]` : ip;
  const url = `http://${host}:${port}/.well-known/as-inventory-auth.txt`;
  try {
    // `redirect: 'error'` – we NEVER follow redirects. A redirect could send
    // us to a host outside the authorized scope, which would defeat the
    // whole point of pinning the request to the approved IP.
    const resp = await fetch(url, { signal: controller.signal, redirect: 'error' });
    if (!resp.ok) {
      logger.warn({ ip, status: resp.status }, 'Proof fetch non-200');
      return false;
    }
    const body = (await resp.text()).trim();
    return body === nonce;
  } catch (err) {
    logger.warn({ ip, err }, 'Proof fetch error or timeout');
    return false;
  } finally {
    clearTimeout(timer);
  }
};

export default { verifyProof };
