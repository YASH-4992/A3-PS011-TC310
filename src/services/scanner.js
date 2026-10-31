import net from 'net';
import tls from 'tls';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import config from '../config/index.js';
import { isIpInScope, isValidIp } from '../utils/ip.js';
import { resolveHostname } from './resolver.js';

/**
 * scanner.js – the network probe.
 *
 * SECURITY RULES ENFORCED HERE (do not remove):
 *  1. FAIL CLOSED. Every IP we are about to touch is re-checked against
 *     SCOPE_CIDRS *at scan time*, not only when the target was created.
 *  2. PINNED IPs. We connect to the numeric IP we validated, never to a name
 *     we would have to look up again (that would be a DNS-rebinding hole).
 *  3. READ-ONLY. We connect, read a small banner / a small HTTP response /
*     the TLS certificate, and disconnect. No exploitation, no brute force,
 *     no fuzzing, no payload delivery.
 *  4. GENTLE. A concurrency cap, a delay between ports and short timeouts.
 */

/**
 * Sleeps for the given number of milliseconds.
 *
 * SYNTAX: `new Promise((resolve) => setTimeout(resolve, ms))` creates a promise
 * that resolves after the timer fires. `await` then pauses this function
 * without blocking the Node event loop (other scans keep running).
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Opens a TCP connection with a timeout.
 *
 * WHY `new net.Socket()` + `socket.connect()` instead of `net.connect()`:
 * it gives us a handle we can destroy ourselves, and it lets us attach the
 * timeout handler before the connection is attempted.
 *
 * @param {string} ip - numeric IP (already scope-checked)
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<net.Socket|null>} the connected socket, or null
 */
const connectTcp = (ip, port, timeoutMs) => {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    // SYNTAX: a small helper so we only ever resolve the promise ONCE.
    const settle = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => settle(socket));
    socket.once('timeout', () => { socket.destroy(); settle(null); });
    socket.once('error', () => { socket.destroy(); settle(null); });

    socket.connect({ host: ip, port });
  });
};

/**
 * Reads a banner from an already-connected socket.
 *
 * WHY A BYTE LIMIT: a hostile or misconfigured service could stream forever.
 * We read at most `maxBytes` and then disconnect. This is read-only and
 * bounded.
 *
 * @param {net.Socket} socket
 * @param {number} timeoutMs
 * @param {number} maxBytes
 * @returns {Promise<string>}
 */
const grabBanner = (socket, timeoutMs, maxBytes) => {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const settle = () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks).toString('utf8').slice(0, maxBytes).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim());
      }
    };

    const timer = setTimeout(() => { socket.destroy(); settle(); }, timeoutMs);

    socket.on('data', (chunk) => {
      const remaining = maxBytes - size;
      chunks.push(chunk.subarray(0, remaining));
      size += Math.min(chunk.length, remaining);
      if (size >= maxBytes) {
        clearTimeout(timer);
        socket.destroy();
        settle();
      }
    });
    socket.on('close', () => { clearTimeout(timer); settle(); });
    socket.on('error', () => { clearTimeout(timer); settle(); });
  });
};

/**
 * Performs a TLS handshake against a PINNED ip and reads the certificate.
 *
 * WHY `rejectUnauthorized: false`:
 *   We are a READ-ONLY inventory tool. We only want to READ the certificate
 *   the server presents so we can record subject / issuer / expiry /
 *   fingerprint. Verifying the chain would make us reject the lab's
 *   self-signed certificate and we would never be able to inventory it.
 *   This does NOT weaken any authorization decision: the target and the IP
 *   were already validated against SCOPE_CIDRS, and we never send
 *   credentials or write anything to the server.
 *
 * WHY `servername` (SNI): the TLS handshake must present the HOSTNAME the
 * operator asked for, otherwise virtual-hosted servers send the wrong
 * certificate. We still connect to the pinned IP.
 *
 * @param {string} ip - pinned numeric IP
 * @param {string} hostname - hostname for SNI
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<Object|null>}
 */
const readTlsCertificate = (ip, hostname, port, timeoutMs) => {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    const socket = tls.connect({
      host: ip, // connect to the PINNED ip, never to the name
      port,
      servername: hostname, // SNI
      rejectUnauthorized: false, // READ-ONLY certificate inventory - see comment above
      timeout: timeoutMs,
    });

    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate(true);
      if (!cert || !cert.raw) {
        socket.destroy();
        settle(null);
        return;
      }

      // SHA-256 fingerprint of the raw DER certificate, colon separated.
      const fingerprint = crypto
        .createHash('sha256')
        .update(cert.raw)
        .digest('hex')
        .match(/.{2}/g)
        .join(':');

      const format = (obj) => (obj ? Object.entries(obj).map(([k, v]) => `${k}=${v}`).join(', ') : '');

      socket.destroy();
      settle({
        subject: format(cert.subject),
        issuer: format(cert.issuer),
        notBefore: cert.valid_from || '',
        notAfter: cert.valid_to || '',
        fingerprint,
      });
    });

    socket.once('error', () => { socket.destroy(); settle(null); });
    socket.once('timeout', () => { socket.destroy(); settle(null); });
  });
};

/**
 * A very light, read-only HTTP probe.
 *
 * It sends ONE `GET /` request with `Connection: close`, reads at most 8 KB of
 * the response body, and extracts the status code, the `Server` header and
 * the `<title>` of the page. That is all an inventory tool needs.
 *
 * @param {string} ip - pinned numeric IP to connect to
 * @param {string} hostname - used for the `Host` header and SNI
 * @param {number} port
 * @param {boolean} useTls
 * @param {number} timeoutMs
 * @returns {Promise<{status: number, server: string, title: string}|null>}
 */
const httpProbe = (ip, hostname, port, useTls, timeoutMs) => {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    const client = useTls ? https : http;
    const req = client.request({
      hostname: ip, // pinned ip
      port,
      method: 'GET',
      path: '/',
      headers: {
        Host: hostname, // correct virtual-host routing
        'User-Agent': 'AIORI-ASM/1.0 (authorized inventory)',
        Connection: 'close',
      },
      ...(useTls ? { servername: hostname, rejectUnauthorized: false } : {}),
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      let size = 0;

      res.on('data', (chunk) => {
        const remaining = 8192 - size;
        chunks.push(chunk.subarray(0, remaining));
        size += Math.min(chunk.length, remaining);
        if (size >= 8192) {
          // Enforce the read limit - stop pulling data from the socket.
          req.destroy();
          const body = Buffer.concat(chunks).toString('utf8');
          settle({
            status: res.statusCode,
            server: res.headers.server || '',
            title: (body.match(/<title[^>]*>([^<]*)<\/title>/i) || [null, ''])[1].trim(),
          });
        }
      });

      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        settle({
          status: res.statusCode,
          server: res.headers.server || '',
          title: (body.match(/<title[^>]*>([^<]*)<\/title>/i) || [null, ''])[1].trim(),
        });
      });
    });

    req.on('error', () => settle(null));
    req.on('timeout', () => { req.destroy(); settle(null); });
    req.end();
  });
};

/**
 * Probes a single port on a single pinned IP.
 *
 * @param {string} ip - already scope-checked numeric IP
 * @param {string} hostname - hostname for SNI / Host header
 * @param {number} port
 * @param {Object} opts
 * @returns {Promise<Object|null>} null when the port is closed
 */
const probePort = async (ip, hostname, port, opts) => {
  const {
    connectTimeoutMs,
    bannerTimeoutMs,
    bannerMaxBytes,
    tlsPorts,
    httpPorts,
  } = opts;

  // RULE 1 - fail closed. Re-check the scope for EVERY probe, not only once
  // per scan. If the scope list is empty, `isIpInScope` returns false and we
  // never open a socket.
  if (!isIpInScope(ip, config.scopeCidrs)) {
    return null;
  }

  const socket = await connectTcp(ip, port, connectTimeoutMs);
  if (!socket) {
    return null; // closed / filtered / refused
  }

  const isTlsPort = tlsPorts.includes(port);
  const isHttpPort = httpPorts.includes(port);

  let banner = '';
  let tlsInfo = null;
  let httpInfo = null;

  if (isTlsPort) {
    // A TLS server will not send a banner before the handshake, so there is
    // nothing to read here - drop the plain socket and do the handshake.
    socket.destroy();
    tlsInfo = await readTlsCertificate(ip, hostname, port, connectTimeoutMs);
  } else if (isHttpPort) {
    // Same for HTTP: the server waits for our request. Drop the socket and
    // let the HTTP probe do the work.
    socket.destroy();
    httpInfo = await httpProbe(ip, hostname, port, false, connectTimeoutMs);
  } else {
    banner = await grabBanner(socket, bannerTimeoutMs, bannerMaxBytes);
    socket.destroy();
  }

  return {
    port,
    protocol: isTlsPort ? 'tls' : 'tcp',
    banner,
    tls: tlsInfo,
    http: httpInfo,
  };
};

/**
 * Works out which IPs we are allowed to probe for a target.
 *
 * WHY WE RESOLVE AT ALL: the target stores an IP, but a hostname can point
 * somewhere else by the time we scan (DNS rebinding). So we resolve the name
 * again, and EVERY resolved IP must be inside SCOPE_CIDRS. We then connect
 * to those pinned IPs - never to the name - so the address we validated is
 * the address we talk to.
 *
 * FALLBACK: if the name simply does not exist in DNS (a lab host such as
 * `lab`), we fall back to the stored IP, which was scope-checked by the
 * caller immediately before this function was called.
 *
 * @param {Object} target
 * @returns {Promise<string[]>} list of allowed IPs
 */
const resolveAllowedIps = async (target) => {
  if (isValidIp(target.hostname)) {
    if (!isIpInScope(target.hostname, config.scopeCidrs)) {
      throw new Error(`Target hostname ${target.hostname} is outside authorized scope`);
    }
    return [target.hostname];
  }
  try {
    const resolved = await resolveHostname(target.hostname, config.scopeCidrs);
    return [...resolved.ipv4, ...resolved.ipv6];
  } catch (err) {
    const noRecords = /No A or AAAA records/i.test(err.message);
    if (!noRecords) {
      throw err; // real failure (e.g. a resolved IP outside the scope)
    }
    // No DNS record -> use the stored IP (already validated by the caller).
    return [target.ip];
  }
};

/**
 * Runs a scan against a target.
 *
 * @param {Object} target - Mongoose Target document
 * @param {Object} options
 * @param {string} options.scanId
 * @param {number[]} [options.ports] - internal override for tests; production uses SCAN_PORTS
 * @returns {Promise<Object>} snapshot data (not yet persisted)
 */
export const runScan = async (target, {
  scanId,
  ports: portOverride,
  tlsPorts: tlsPortOverride,
  httpPorts: httpPortOverride,
} = {}) => {
  const startedAt = new Date();

  if (!isIpInScope(target.ip, config.scopeCidrs)) {
    throw new Error(`Target IP ${target.ip} is outside authorized scope`);
  }

  // Resolve + validate every IP we are about to touch.
  const ips = await resolveAllowedIps(target);

  const ports = portOverride === undefined
    ? [...new Set(config.scanner.ports)]
    : [...new Set(portOverride.filter((port) => Number.isInteger(port) && port > 0 && port <= 65535))];
  const tlsPorts = tlsPortOverride || config.scanner.tlsPorts;
  const httpPorts = httpPortOverride || config.scanner.httpPorts;

  const results = [];
  const queue = [...ports];
  const workerCount = Math.max(1, Math.min(config.scanner.maxConcurrent, ports.length));

  /**
   * A worker pulls one port at a time from the shared queue. This is how we
   * keep the number of simultaneous connections under the configured cap.
   */
  const worker = async () => {
    while (queue.length > 0) {
      const port = queue.shift();
      if (port === undefined) {
        break;
      }

      for (const ip of ips) {
        const result = await probePort(ip, target.hostname, port, {
          connectTimeoutMs: config.scanner.connectTimeoutMs,
          bannerTimeoutMs: config.scanner.bannerTimeoutMs,
          bannerMaxBytes: config.scanner.bannerMaxBytes,
          tlsPorts,
          httpPorts,
        });
        if (result) {
          results.push({ ...result, ip });
        }
      }

      // Be gentle: pause between ports so we never flood a host.
      if (config.scanner.interPortDelayMs > 0) {
        await sleep(config.scanner.interPortDelayMs);
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const completedAt = new Date();
  return {
    target: target._id,
    scanId,
    ports: results,
    status: 'completed',
    startedAt,
    completedAt,
    durationMs: completedAt.getTime() - startedAt.getTime(),
  };
};

export default { runScan };
