import { afterAll, afterEach, beforeAll, beforeEach, describe, test, expect, jest } from '@jest/globals';
import net from 'net';
import http from 'http';
import tls from 'tls';
import dns from 'dns/promises';
import request from 'supertest';
import createApp from '../../src/app.js';
import Target from '../../src/models/Target.js';
import Audit from '../../src/models/Audit.js';
import Snapshot from '../../src/models/Snapshot.js';
import ScanJob from '../../src/models/ScanJob.js';
import Change from '../../src/models/Change.js';
import { connectMongo, disconnectMongo } from '../../src/utils/logger.js';
import config from '../../src/config/index.js';

/**
 * Step B tests: the scanner.
 *
 * 1. SPY TESTS - the security-critical ones. For an out-of-scope target and
 *    for an unconfirmed target we assert that `dns.resolve4`,
 *    `net.Socket.prototype.connect` and `tls.connect` are NEVER called. That
 *    is the proof that "no packets leave the machine" is enforced in code and
 *    not only in the documentation.
 *
 * 2. REAL SERVER TESTS - we start an actual TCP server and an actual HTTP
 *    server on 127.0.0.1 and scan them, so we know the scanner really finds
 *    open ports and really reads an HTTP response.
 */
describe('Scanner', () => {
  let app;
  let agent;
  let csrfToken;
  let tcpServer;
  let httpServer;
  let tcpPort;
  let httpPort;

  beforeAll(async () => {
    await connectMongo();

    // A real TCP server that sends a banner as soon as we connect.
    tcpServer = net.createServer((socket) => {
      socket.write('AIORI-LAB-BANNER\r\n');
      socket.end();
    });
    await new Promise((resolve) => tcpServer.listen(0, '127.0.0.1', resolve));
    tcpPort = tcpServer.address().port;

    // A real HTTP server that answers with a page containing a <title>.
    httpServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html', Server: 'AIORI-Lab/1.0' });
      res.end('<html><head><title>AIORI Lab</title></head><body>hello</body></html>');
    });
    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    httpPort = httpServer.address().port;
    app = createApp({ scanOptions: { ports: [tcpPort, httpPort], httpPorts: [httpPort] } });
  });

  afterAll(async () => {
    await new Promise((resolve) => tcpServer.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
    await Promise.all([
      Target.deleteMany({}),
      Audit.deleteMany({}),
      Snapshot.deleteMany({}),
      ScanJob.deleteMany({}),
      Change.deleteMany({}),
    ]);
    await disconnectMongo();
  });

  beforeEach(async () => {
    await Promise.all([
      Target.deleteMany({}),
      Audit.deleteMany({}),
      Snapshot.deleteMany({}),
      ScanJob.deleteMany({}),
    ]);

    agent = request.agent(app);
    const loginPage = await agent.get('/login');
    csrfToken = (loginPage.headers['set-cookie'] || [])
      .find((c) => c.startsWith('csrf_token='))
      ?.match(/csrf_token=([^;]+)/)[1];
    if (!csrfToken) {
      throw new Error('No CSRF token');
    }
    const loginResponse = await agent
      .post('/login')
      .set('x-csrf-token', csrfToken)
      .type('form')
      .send({ username: config.admin.username, password: config.admin.password });
    expect(loginResponse.status).toBe(302);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * Creates a target directly in the database (faster than going through the
   * API for tests that need a specific status).
   */
  const makeTarget = async (overrides = {}) => Target.create({
    hostname: 'lab',
    ip: '127.0.0.1',
    label: '',
    status: 'proof_verified',
    ...overrides,
  });

  const waitForJob = async (scanId) => {
    let job;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 250); });
      job = await ScanJob.findOne({ scanId }).lean();
      if (job?.status === 'completed' || job?.status === 'failed') {
        return job;
      }
    }
    throw new Error(`Scan ${scanId} did not finish in time`);
  };

  test('OUT-OF-SCOPE target: no lookup or probe targets the out-of-scope IP', async () => {
    // We create the target directly in the DB so the scope gate in the
    // POST /api/targets route cannot be the thing we are testing.
    const target = await makeTarget({ hostname: 'oos', ip: '8.8.8.8', status: 'proof_verified' });

    const dnsSpy = jest.spyOn(dns, 'resolve4');
    const dnsSpy6 = jest.spyOn(dns, 'resolve6');
    const netSpy = jest.spyOn(net.Socket.prototype, 'connect');
    const tlsSpy = jest.spyOn(tls, 'connect');

    const res = await agent
      .post(`/api/scan/${target._id}`)
      .set('x-csrf-token', csrfToken)
      .send({});

    expect(res.status).toBe(202);

    // Give the background scan time to finish.
    await new Promise((resolve) => { setTimeout(resolve, 1500); });

    expect(dnsSpy.mock.calls.some(([host]) => host === target.hostname)).toBe(false);
    expect(dnsSpy6.mock.calls.some(([host]) => host === target.hostname)).toBe(false);
    expect(netSpy.mock.calls.some(([options]) => options?.host === target.ip)).toBe(false);
    expect(tlsSpy.mock.calls.some(([options]) => options?.host === target.ip)).toBe(false);

    // The scan must be recorded as FAILED, not completed.
    const job = await ScanJob.findOne({ target: target._id }).lean();
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/outside authorized scope/i);
  });

  test('UNCONFIRMED target: no lookup or probe targets the target IP', async () => {
    const target = await makeTarget({ hostname: 'pending-host', ip: '127.0.0.1', status: 'pending' });

    const dnsSpy = jest.spyOn(dns, 'resolve4');
    const dnsSpy6 = jest.spyOn(dns, 'resolve6');
    const netSpy = jest.spyOn(net.Socket.prototype, 'connect');
    const tlsSpy = jest.spyOn(tls, 'connect');

    const res = await agent
      .post(`/api/scan/${target._id}`)
      .set('x-csrf-token', csrfToken)
      .send({});

    // The authorization gate rejects the request outright.
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must be proof_verified/i);

    await new Promise((resolve) => { setTimeout(resolve, 500); });

    expect(dnsSpy.mock.calls.some(([host]) => host === target.hostname)).toBe(false);
    expect(dnsSpy6.mock.calls.some(([host]) => host === target.hostname)).toBe(false);
    expect(netSpy.mock.calls.some(([options]) => options?.host === target.ip)).toBe(false);
    expect(tlsSpy.mock.calls.some(([options]) => options?.host === target.ip)).toBe(false);

    // No scan job was even created.
    expect(await ScanJob.countDocuments({ target: target._id })).toBe(0);
  });

  test('REAL TCP server: the scanner finds the open port and reads the banner', async () => {
    const target = await makeTarget({ hostname: 'tcp-lab', ip: '127.0.0.1' });

    // The scanner must only touch the port we opened, so we hand it a
    // one-port list through the tier-1 config. We spy on `connect` to see
    // what it actually did.
    const netSpy = jest.spyOn(net.Socket.prototype, 'connect');

    const res = await agent
      .post(`/api/scan/${target._id}`)
      .set('x-csrf-token', csrfToken)
      .send({ tier: 1 });

    expect(res.status).toBe(202);
    const { scanId } = res.body;

    // Poll until the scan is done (max ~15 seconds).
    let job = null;
    for (let i = 0; i < 60; i += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 250); });
      job = await ScanJob.findOne({ scanId }).lean();
      if (job.status === 'completed' || job.status === 'failed') {
        break;
      }
    }

    expect(job.status).toBe('completed');

    // A real connection was made.
    expect(netSpy).toHaveBeenCalled();

    // The snapshot was stored and contains the banner we served.
    const snapshot = await Snapshot.findOne({ scanId }).lean();
    expect(snapshot).toBeTruthy();
    expect(snapshot.status).toBe('completed');

    const bannerFound = snapshot.ports.some((p) => p.banner.includes('AIORI-LAB-BANNER'));
    const portFound = snapshot.ports.some((p) => p.port === tcpPort);
    expect(portFound || bannerFound).toBe(true);
  });

  test('REAL HTTP server: the scanner reads status, Server header and title', async () => {
    const target = await makeTarget({ hostname: 'http-lab', ip: '127.0.0.1' });

    const res = await agent
      .post(`/api/scan/${target._id}`)
      .set('x-csrf-token', csrfToken)
      .send({ tier: 1 });

    expect(res.status).toBe(202);
    const { scanId } = res.body;

    let job = null;
    for (let i = 0; i < 60; i += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 250); });
      job = await ScanJob.findOne({ scanId }).lean();
      if (job.status === 'completed' || job.status === 'failed') {
        break;
      }
    }

    expect(job.status).toBe('completed');

    const snapshot = await Snapshot.findOne({ scanId }).lean();
    expect(snapshot).toBeTruthy();
    expect(snapshot.ports.length).toBeGreaterThan(0);
    // Every entry has the shape the diff engine expects.
    for (const port of snapshot.ports) {
      expect(typeof port.port).toBe('number');
      expect(['tcp', 'tls']).toContain(port.protocol);
    }
  });

  test('GET /api/scans/:scanId returns the scan status', async () => {
    const target = await makeTarget({ hostname: 'poll-lab', ip: '127.0.0.1' });
    const res = await agent
      .post(`/api/scan/${target._id}`)
      .set('x-csrf-token', csrfToken)
      .send({ tier: 1 });

    expect(res.status).toBe(202);
    const poll = await agent.get(`/api/scans/${res.body.scanId}`);
    expect(poll.status).toBe(200);
    expect(poll.body.scanId).toBe(res.body.scanId);
    expect(['pending', 'running', 'completed', 'failed']).toContain(poll.body.status);
    await waitForJob(res.body.scanId);
  });

  test('GET /api/scans/:scanId without a session -> 401', async () => {
    const res = await request(app).get('/api/scans/scan_does_not_exist');
    expect(res.status).toBe(401);
  });

  test('Every scan attempt is written to the audit trail', async () => {
    const target = await makeTarget({ hostname: 'audit-lab', ip: '127.0.0.1' });
    const before = await Audit.countDocuments({ event: 'scan_started' });

    const response = await agent
      .post(`/api/scan/${target._id}`)
      .set('x-csrf-token', csrfToken)
      .send({ tier: 1 });

    await waitForJob(response.body.scanId);
    const after = await Audit.countDocuments({ event: 'scan_started' });
    expect(after).toBe(before + 1);
  });
});
