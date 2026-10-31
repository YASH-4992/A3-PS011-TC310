import { describe, test, expect } from '@jest/globals';
import { parseIp, isValidIp, buildRange, ipInRange, isIpInScope } from '../../src/utils/ip.js';

describe('IP utilities', () => {
  test('parseIp valid IPv4', () => {
    expect(parseIp('192.168.1.5')).toBeTruthy();
  });
  test('parseIp valid IPv6', () => {
    expect(parseIp('2001:db8::1')).toBeTruthy();
  });
  test('parseIp invalid', () => {
    expect(parseIp('not-an-ip')).toBeNull();
  });
  test('isValidIp works', () => {
    expect(isValidIp('8.8.8.8')).toBe(true);
    expect(isValidIp('2001:db8::1')).toBe(true);
    expect(isValidIp('999.999.999.999')).toBe(false);
  });
  test('CIDR range inclusion IPv4', () => {
    const range = buildRange('10.0.0.0/8');
    expect(ipInRange('10.5.6.7', range)).toBe(true);
    expect(ipInRange('192.168.0.1', range)).toBe(false);
  });
  test('CIDR range inclusion IPv6', () => {
    const range = buildRange('2001:db8::/32');
    expect(ipInRange('2001:db8::1', range)).toBe(true);
    expect(ipInRange('2001:db9::1', range)).toBe(false);
  });
  test('isIpInScope with list', () => {
    const scope = ['10.0.0.0/8', '2001:db8::/32'];
    expect(isIpInScope('10.1.2.3', scope)).toBe(true);
    expect(isIpInScope('2001:db8::5', scope)).toBe(true);
    expect(isIpInScope('8.8.8.8', scope)).toBe(false);
  });
});
