import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const proofPath = path.join(root, '.lab-data', 'proof.txt');
const databaseName = `aiori_verify_${Date.now()}`;
const databaseUri = 'mongodb://127.0.0.1:27017';
const adminPassword = `verify-${Date.now()}-A1!`;
const results = [];
let labProcess;
let appProcess;
let database;
const cookieJar = new Map();
let csrfToken = '';

function record(name, success, message = '') {
  results.push(success);
  console.log(`${success ? 'PASS' : 'FAIL'} ${name}${message ? `: ${message}` : ''}`);
  return success;
}

async function step(name, action) {
  try {
    const result = await action();
    record(name, true);
    return result;
  } catch (error) {
    record(name, false, error.message);
    return null;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function startProcess(args, env) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.output = '';
  child.stdout.on('data', (chunk) => { child.output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { child.output += chunk.toString(); });
  return child;
}

async function waitFor(url, child) {
  const deadline = Date.now() + 20000;
  let lastError = 'service did not become ready';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`process exited ${child.exitCode}: ${child.output.slice(-1000)}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(lastError);
}

function updateCookies(response) {
  const setCookies = response.headers.getSetCookie?.() || [response.headers.get('set-cookie')].filter(Boolean);
  for (const header of setCookies) {
    const pair = header.split(';', 1)[0];
    const separator = pair.indexOf('=');
    if (separator > 0) {
      cookieJar.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
}

async function appRequest(route, { method = 'GET', body, form = false } = {}) {
  const headers = {};
  const cookie = [...cookieJar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
  if (cookie) {
    headers.cookie = cookie;
  }
  if (method !== 'GET') {
    headers['x-csrf-token'] = csrfToken;
  }
  let payload;
  if (form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(body);
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(`http://127.0.0.1:${process.env.VERIFY_APP_PORT}${route}`, {
    method,
    headers,
    body: payload,
    redirect: 'manual',
  });
  updateCookies(response);
  return response;
}

async function waitForScan(scanId) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await appRequest(`/api/scans/${encodeURIComponent(scanId)}`);
    assert(response.ok, `scan polling returned ${response.status}`);
    const job = await response.json();
    if (job.status === 'completed') {
      return job;
    }
    if (job.status === 'failed') {
      throw new Error(`scan failed: ${job.error}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('scan timed out');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) {
    return;
  }
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}

try {
  const appPort = await freePort();
  process.env.VERIFY_APP_PORT = String(appPort);
  const appEnv = {
    NODE_ENV: 'test',
    PORT: String(appPort),
    ADMIN_USERNAME: 'verify-admin',
    ADMIN_PASSWORD: adminPassword,
    SESSION_SECRET: `verify-session-${Date.now()}-secret`,
    MONGODB_URI: databaseUri,
    MONGODB_DB_NAME: databaseName,
    SCOPE_CIDRS: '127.0.0.1/32',
    SCAN_PORTS: '8080,8443,9100',
    SCAN_MAX_CONCURRENT: '3',
    SCAN_INTER_PORT_DELAY_MS: '0',
    SCAN_CONNECT_TIMEOUT_MS: '700',
    SCAN_BANNER_TIMEOUT_MS: '400',
    PROOF_HTTP_PORT: '8080',
    REQUIRE_PROOF_BEFORE_SCAN: 'true',
    LOG_LEVEL: 'silent',
  };
  labProcess = startProcess(['scripts/lab.mjs', 'start'], {});
  await step('lab ready on loopback', () => waitFor('http://127.0.0.1:9191/health', labProcess));

  appProcess = startProcess(['src/index.js'], appEnv);
  await step('app ready with isolated verification database', () => waitFor(`http://127.0.0.1:${appPort}/health`, appProcess));

  database = await mongoose.createConnection(databaseUri, { dbName: databaseName }).asPromise();

  const loginPage = await step('login page and CSRF token', async () => {
    const response = await appRequest('/login');
    assert(response.status === 200, `expected 200, got ${response.status}`);
    csrfToken = decodeURIComponent(cookieJar.get('csrf_token') || '');
    assert(csrfToken.length > 0, 'CSRF cookie was not set');
    return response;
  });

  await step('login', async () => {
    assert(loginPage, 'login page failed');
    const response = await appRequest('/login', {
      method: 'POST',
      form: true,
      body: { username: 'verify-admin', password: adminPassword, _csrf: csrfToken },
    });
    assert(response.status === 302 && response.headers.get('location') === '/dashboard', `login returned ${response.status}`);
  });

  const target = await step('add authorized in-scope target', async () => {
    const response = await appRequest('/api/targets', {
      method: 'POST',
      body: { hostname: '127.0.0.1', ip: '127.0.0.1', authorized: true },
    });
    const payload = await response.json();
    assert(response.status === 201, payload.error || `target creation returned ${response.status}`);
    return payload;
  });

  await step('confirm target authorization', async () => {
    assert(target, 'target was not created');
    const response = await appRequest(`/api/targets/${target.id}/confirm`, {
      method: 'POST',
      body: { authorized: true },
    });
    assert(response.status === 200, `confirmation returned ${response.status}`);
  });

  await step('verify target proof file', async () => {
    assert(target, 'target was not created');
    fs.mkdirSync(path.dirname(proofPath), { recursive: true });
    fs.writeFileSync(proofPath, target.proofNonce, 'utf8');
    const response = await appRequest(`/api/targets/${target.id}/verify-proof`, { method: 'POST', body: {} });
    const payload = await response.json();
    assert(response.status === 200, payload.error || `proof verification returned ${response.status}`);
  });

  const firstScan = await step('baseline scan has real HTTP and HTTPS ports', async () => {
    assert(target, 'target was not created');
    const response = await appRequest(`/api/scan/${target.id}`, { method: 'POST', body: {} });
    const payload = await response.json();
    assert(response.status === 202, payload.error || `scan start returned ${response.status}`);
    const job = await waitForScan(payload.scanId);
    const ports = job.snapshot?.ports?.map((entry) => entry.port) || [];
    assert(ports.includes(8080), 'real HTTP lab port was not discovered');
    assert(ports.includes(8443), 'real HTTPS lab port was not discovered');
    return job;
  });

  await step('open additional authorized TCP port', async () => {
    const response = await fetch('http://127.0.0.1:9191/open-port', { method: 'POST' });
    assert(response.status === 200, await response.text());
  });

  await step('replace HTTPS certificate', async () => {
    const response = await fetch('http://127.0.0.1:9191/swap-cert', { method: 'POST' });
    assert(response.status === 200, await response.text());
  });

  const secondScan = await step('rescan detects opened port and changed certificate', async () => {
    assert(target && firstScan, 'baseline scan did not complete');
    const response = await appRequest(`/api/scan/${target.id}`, { method: 'POST', body: {} });
    const payload = await response.json();
    assert(response.status === 202, payload.error || `rescan start returned ${response.status}`);
    const job = await waitForScan(payload.scanId);
    const changes = await database.db.collection('changes').find({ target: new mongoose.Types.ObjectId(target.id) }).toArray();
    const types = new Set(changes.map((change) => change.type));
    assert(types.has('port_opened'), 'port_opened was not recorded');
    assert(types.has('cert_changed'), 'cert_changed was not recorded');
    return { job, types };
  });

  await step('out-of-scope target rejected without scan traffic', async () => {
    const response = await appRequest('/api/targets', {
      method: 'POST',
      body: { hostname: 'out-of-scope.invalid', ip: '8.8.8.8', authorized: true },
    });
    const payload = await response.json();
    assert(response.status === 400 && /outside the authorized scope/i.test(payload.error), 'out-of-scope target was not rejected');
    assert(!response.headers.get('location'), 'unexpected network redirect');
  });

  await step('audit records exist for authentication, targets, and scans', async () => {
    const events = await database.db.collection('audits').find({}).toArray();
    const types = new Set(events.map((event) => event.event));
    for (const expected of [
      'login_success',
      'target_created',
      'target_confirmed',
      'target_proof_verified',
      'scan_started',
      'scan_completed',
      'target_out_of_scope',
    ]) {
      assert(types.has(expected), `audit event ${expected} is missing`);
    }
    assert(events.length >= 8, `expected multiple audit events, found ${events.length}`);
  });
} catch (error) {
  record('verification harness', false, error.message);
} finally {
  await stopProcess(appProcess);
  await stopProcess(labProcess);
  if (database) {
    try {
      await database.dropDatabase();
      record('isolated verification database cleanup', true);
    } catch (error) {
      record('isolated verification database cleanup', false, error.message);
    }
    await database.close();
  }
  if (fs.existsSync(proofPath)) {
    fs.unlinkSync(proofPath);
  }
}

if (results.length === 0 || results.some((success) => !success)) {
  process.exitCode = 1;
}
