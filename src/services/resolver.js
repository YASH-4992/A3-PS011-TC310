import dns from 'dns/promises';
import { isIpInScope } from '../utils/ip.js';

/**
 * Resolves a hostname to its A / AAAA records and validates every IP against
 * the authorized scope. If ANY resolved IP is out of scope the entire target
 * is rejected (fail closed).
 *
 * @param {string} hostname
 * @param {string[]} scopeCidrs
 * @returns {Promise<{ipv4: string[], ipv6: string[]}>}
 */
export const resolveHostname = async (hostname, scopeCidrs) => {
  const results = { ipv4: [], ipv6: [] };

  // A records (IPv4)
  try {
    const aRecords = await dns.resolve4(hostname);
    for (const ip of aRecords) {
      if (!isIpInScope(ip, scopeCidrs)) {
        throw new Error(`Resolved IP ${ip} is outside authorized scope`);
      }
      results.ipv4.push(ip);
    }
  } catch (err) {
    if (err.code !== 'ENODATA' && err.code !== 'ENOTFOUND') {
      throw err;
    }
  }

  // AAAA records (IPv6)
  try {
    const aaaaRecords = await dns.resolve6(hostname);
    for (const ip of aaaaRecords) {
      if (!isIpInScope(ip, scopeCidrs)) {
        throw new Error(`Resolved IP ${ip} is outside authorized scope`);
      }
      results.ipv6.push(ip);
    }
  } catch (err) {
    if (err.code !== 'ENODATA' && err.code !== 'ENOTFOUND') {
      throw err;
    }
  }

  if (results.ipv4.length === 0 && results.ipv6.length === 0) {
    throw new Error(`No A or AAAA records found for ${hostname}`);
  }

  return results;
};

export default { resolveHostname };