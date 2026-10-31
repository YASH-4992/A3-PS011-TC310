import ipaddr from 'ipaddr.js';
import net from 'net';

/**
 * IP / CIDR helpers.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The scope allowlist (`SCOPE_CIDRS`) is the single gate that decides whether
 * this tool is allowed to send a single packet to an address. Every check
 * that decides "may I touch this host?" funnels through `isIpInScope()` here,
 * so there is exactly ONE place where that rule is implemented and it can be
 * unit tested in isolation.
 *
 * FAIL CLOSED BY DESIGN
 * ---------------------
 * `isIpInScope()` returns `false` when the scope list is empty. An operator
 * who has not defined a scope gets NO scan - never an "allow by default".
 */

/**
 * Parses a string into an ipaddr.js object.
 *
 * SYNTAX: `ipaddr.parse('1.2.3.4')` returns an IPv4 object and
 * `ipaddr.parse('::1')` returns an IPv6 object. It THROWS on garbage, so we
 * wrap it in try/catch and return `null` instead.
 *
 * @param {string} ip
 * @returns {object|null}
 */
export const parseIp = (ip) => {
  // WHY `net.isIP` FIRST:
  // `net.isIP()` is Node's own, battle-tested validator. It returns 4 for a
  // valid IPv4 address, 6 for a valid IPv6 address and 0 for anything else.
  // Using it as the gate means garbage like '999.999.999.999' or
  // '127.0.0.1/24' is rejected before it ever reaches the CIDR math.
  const version = net.isIP(String(ip).trim());
  if (version === 0) {
    return null;
  }
  try {
    return ipaddr.parse(String(ip).trim());
  } catch {
    return null;
  }
};

/**
 * True when the string looks like a valid IPv4 or IPv6 address.
 *
 * SYNTAX: `Boolean(obj)` converts a truthy/falsy value into `true`/`false`.
 *
 * @param {string} ip
 * @returns {boolean}
 */
export const isValidIp = (ip) => net.isIP(String(ip).trim()) !== 0;

/**
 * Builds a byte-range for a CIDR block (or a bare IP).
 *
 * A CIDR like `192.168.10.0/24` describes a contiguous block of addresses.
 * We represent it as two byte arrays - `start` (lowest address in the block)
 * and `end` (highest address) - so a membership test is a simple comparison
 * per byte.
 *
 * SYNTAX (bitwise):
 *   `a & m`  -> bitwise AND  (keep only the bits the mask allows)
 *   `~m`     -> bitwise NOT   (flip every bit)
 *   `s | (~m & 0xff)` -> set every bit the mask did NOT allow
 *
 * The `& 0xff` is important: in JavaScript `~0` is `-1`, and `-1 & 0xff`
 * is `255`. Masking keeps the result a valid 0-255 byte.
 *
 * @param {string} cidr e.g. '10.0.0.0/8', '127.0.0.1', '2001:db8::/32'
 * @returns {{start: number[], end: number[], kind: string}|null}
 */
export const buildRange = (cidr) => {
  let cidrText = String(cidr || '').trim();
  if (!cidrText) {
    return null;
  }

  // A bare IP is treated as a single-host range (/32 for IPv4, /128 for IPv6).
  if (!cidrText.includes('/')) {
    const parsed = parseIp(cidrText);
    if (!parsed) {
      return null;
    }
    cidrText = `${cidrText}/${parsed.kind() === 'ipv4' ? 32 : 128}`;
  }

  let network;
  let prefixLength;
  try {
    // ipaddr.parseCIDR returns [address, prefixLength]
    [network, prefixLength] = ipaddr.parseCIDR(cidrText);
  } catch {
    return null;
  }

  const networkBytes = network.toByteArray();
  const byteCount = networkBytes.length;

  // Build mask bytes from prefix length
  const maskBytes = [];
  let remaining = prefixLength;
  for (let i = 0; i < byteCount; i += 1) {
    const bits = Math.min(8, Math.max(0, remaining));
    const mask = bits === 0 ? 0 : (0xff << (8 - bits)) & 0xff;
    maskBytes.push(mask);
    remaining -= bits;
  }

  const start = [];
  const end = [];
  for (let i = 0; i < byteCount; i += 1) {
    const n = networkBytes[i] & maskBytes[i];
    start.push(n);
    end.push(n | (~maskBytes[i] & 0xff));
  }

  return { start, end, kind: network.kind() };
};

/**
 * True when `ip` falls inside a range produced by `buildRange()`.
 *
 * @param {string} ip
 * @param {{start: number[], end: number[], kind: string}} range
 * @returns {boolean}
 */
export const ipInRange = (ip, range) => {
  const parsed = parseIp(ip);
  if (!parsed || !range) {
    return false;
  }
  // An IPv4 address can never be inside an IPv6 range (and vice versa).
  if (parsed.kind() !== range.kind) {
    return false;
  }
  const bytes = parsed.toByteArray();
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] < range.start[i] || bytes[i] > range.end[i]) {
      return false;
    }
  }
  return true;
};

/**
 * THE scope gate.
 *
 * Returns true only when the IP is inside at least one of the given CIDR
 * ranges. An empty scope list means "nothing is authorized" -> false.
 *
 * NOTE ON PRIVATE / LOOPBACK ADDRESSES: we deliberately do NOT block them
 * here. The scope allowlist IS the authorisation decision, and a lab target
 * on 127.0.0.1 is in scope precisely because the operator listed
 * `127.0.0.1/32`. A separate "is this a private IP?" rule would be a second,
 * conflicting policy - and it would break the local lab demo.
 *
 * @param {string} ip
 * @param {string[]} scopeCidrs
 * @returns {boolean}
 */
export const isIpInScope = (ip, scopeCidrs = []) => {
  const ranges = (scopeCidrs || []).map(buildRange).filter(Boolean);
  if (ranges.length === 0) {
    return false;
  }
  return ranges.some((range) => ipInRange(ip, range));
};

/**
 * Human-readable summary of the configured scope (used by the UI).
 *
 * @param {string[]} scopeCidrs
 * @returns {string}
 */
export const describeScope = (scopeCidrs = []) => {
  const list = (scopeCidrs || []).filter(Boolean);
  return list.length > 0 ? list.join(', ') : '(no scope configured - scanning is disabled)';
};

export default {
  parseIp,
  isValidIp,
  buildRange,
  ipInRange,
  isIpInScope,
  describeScope,
};
