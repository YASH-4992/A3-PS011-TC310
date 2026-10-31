const snapshotIdOf = (snapshot) => snapshot?._id?.toString?.() || snapshot?.id || null;

const endpointKey = (entry) => `${entry.ip || ''}:${entry.port}`;

const hostSet = (snapshot) => new Set(
  (snapshot?.ports || []).map((entry) => entry.ip).filter(Boolean),
);

const describeEndpoint = (entry) => `${entry.ip || 'unknown host'}:${entry.port}`;

export const diffEngine = (previousSnapshot, nextSnapshot) => {
  if (!previousSnapshot || !nextSnapshot) {
    return [];
  }

  const previousPorts = new Map((previousSnapshot.ports || []).map((entry) => [endpointKey(entry), entry]));
  const nextPorts = new Map((nextSnapshot.ports || []).map((entry) => [endpointKey(entry), entry]));
  const snapshotId = snapshotIdOf(nextSnapshot);
  const previousSnapshotId = snapshotIdOf(previousSnapshot);
  const changes = [];

  const addChange = (type, severity, details, port = null, host = null) => {
    changes.push({
      type,
      severity,
      details,
      port,
      host,
      snapshotId,
      previousSnapshotId,
    });
  };

  const previousHosts = hostSet(previousSnapshot);
  const nextHosts = hostSet(nextSnapshot);
  for (const host of nextHosts) {
    if (!previousHosts.has(host)) {
      addChange('host_added', 'medium', `Host ${host} was added`, null, host);
    }
  }
  for (const host of previousHosts) {
    if (!nextHosts.has(host)) {
      addChange('host_removed', 'medium', `Host ${host} was removed`, null, host);
    }
  }

  for (const [key, next] of nextPorts) {
    const previous = previousPorts.get(key);
    if (!previous) {
      addChange('port_opened', 'high', `Port opened on ${describeEndpoint(next)}`, next.port, next.ip || null);
      continue;
    }
    if ((previous.banner || '') !== (next.banner || '')) {
      addChange(
        'banner_changed',
        'medium',
        `Banner changed on ${describeEndpoint(next)}`,
        next.port,
        next.ip || null,
      );
    }
    const previousFingerprint = previous.tls?.fingerprint || '';
    const nextFingerprint = next.tls?.fingerprint || '';
    if (previousFingerprint !== nextFingerprint && (previousFingerprint || nextFingerprint)) {
      addChange(
        'cert_changed',
        'high',
        `TLS certificate changed on ${describeEndpoint(next)}`,
        next.port,
        next.ip || null,
      );
    }
  }

  for (const [key, previous] of previousPorts) {
    if (!nextPorts.has(key)) {
      addChange(
        'port_closed',
        'medium',
        `Port closed on ${describeEndpoint(previous)}`,
        previous.port,
        previous.ip || null,
      );
    }
  }

  return changes;
};

export default diffEngine;
