import { describe, expect, test } from '@jest/globals';
import { diffEngine } from '../../src/services/diffEngine.js';

const previous = {
  _id: 'snapshot-old',
  ports: [
    { ip: '10.0.0.1', port: 80, banner: 'server/1', tls: { fingerprint: 'old-cert' } },
    { ip: '10.0.0.1', port: 443, banner: '', tls: null },
    { ip: '10.0.0.2', port: 22, banner: 'ssh/1', tls: null },
  ],
};

const next = {
  _id: 'snapshot-new',
  ports: [
    { ip: '10.0.0.1', port: 80, banner: 'server/2', tls: { fingerprint: 'new-cert' } },
    { ip: '10.0.0.1', port: 8080, banner: 'http/1', tls: null },
    { ip: '10.0.0.3', port: 443, banner: '', tls: null },
  ],
};

describe('diffEngine', () => {
  test('treats a first snapshot as a baseline', () => {
    expect(diffEngine(null, next)).toEqual([]);
  });

  test('detects port, banner, certificate, and host changes with snapshot references', () => {
    const changes = diffEngine(previous, next);
    expect(changes.map(({ type }) => type)).toEqual(expect.arrayContaining([
      'port_opened',
      'port_closed',
      'banner_changed',
      'cert_changed',
      'host_added',
      'host_removed',
    ]));
    expect(changes).toHaveLength(8);
    for (const change of changes) {
      expect(change.snapshotId).toBe('snapshot-new');
      expect(change.previousSnapshotId).toBe('snapshot-old');
      expect(['info', 'medium', 'high']).toContain(change.severity);
    }
  });

  test('does not report changes when snapshots match', () => {
    expect(diffEngine(previous, { ...previous, _id: 'snapshot-same-content' })).toEqual([]);
  });
});
