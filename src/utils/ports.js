/**
 * Port tiers.
 *
 * WHY TIERS
 * ---------
 * A full sweep of 65k ports against a host you do not own is rude, slow and
 * unnecessary. Each target carries a `maxTier` that caps how far we are
 * allowed to go:
 *
 *   tier 1 - lab ports only (fast; used for the live demo)
 *   tier 2 - lab ports + ~30 common service ports (the default)
 *   tier 3 - everything configured in `SCAN_PORTS` (widest sweep we allow)
 *
 * The tier is a LIMIT set by the operator. A target can never be scanned at
 * a higher tier than its own `maxTier`, whatever the request asks for.
 */

/** Ports the bundled lab listens on. */
export const LAB_PORTS = [8080, 8443, 9100];

/** Common service ports - discovery only, no exploitation, no fuzzing. */
export const COMMON_PORTS = [
  21, 22, 23, 25, 53, 80, 110, 143, 389, 443, 445, 993, 995,
  1433, 1521, 2049, 3000, 3306, 3389, 5432, 5900, 6379, 8000,
  8080, 8081, 8443, 8888, 9090, 9200, 11211, 27017,
];

/**
 * Removes duplicates while keeping the original order.
 *
 * SYNTAX: `new Set(arr)` keeps only unique values; `spread` (`...`) turns the
 * Set back into an array.
 *
 * @param {number[]} list
 * @returns {number[]}
 */
export const unique = (list) => [...new Set(list)];

/**
 * Returns the port list a target is allowed to be scanned on.
 *
 * @param {number} tier - 1, 2 or 3
 * @param {number[]} configuredPorts - ports from `SCAN_PORTS` (env)
 * @returns {number[]}
 */
export const portsForTier = (tier, configuredPorts = []) => {
  const tierNumber = Number(tier) || 2;

  if (tierNumber >= 3) {
    // Widest sweep: whatever the operator configured, plus the common set.
    const configured = (configuredPorts || []).filter((p) => Number.isInteger(p) && p > 0 && p <= 65535);
    return unique([...LAB_PORTS, ...COMMON_PORTS, ...configured]);
  }
  if (tierNumber === 2) {
    return unique([...LAB_PORTS, ...COMMON_PORTS]);
  }
  return [...LAB_PORTS];
};

/**
 * Ports that usually speak HTTPS - used to decide when to grab a TLS
 * certificate and when to try a light HTTP probe.
 */
export const TLS_PORTS = [443, 8443, 9443, 10443];

/**
 * Ports that usually speak HTTP - used for the light HTTP probe.
 */
export const HTTP_PORTS = [80, 443, 8080, 8000, 8081, 8888, 3000, 5000, 9090, 9200, 8443];

export default { LAB_PORTS, COMMON_PORTS, unique, portsForTier, TLS_PORTS, HTTP_PORTS };
