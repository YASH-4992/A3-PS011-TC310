import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDirectory = path.join(root, '.lab-data');
const keyPath = path.join(dataDirectory, 'server-key.pem');
const certPath = path.join(dataDirectory, 'server-cert.pem');
const proofPath = path.join(dataDirectory, 'proof.txt');
const httpPort = Number(process.env.LAB_HTTP_PORT || 8080);
const httpsPort = Number(process.env.LAB_HTTPS_PORT || 8443);
const controlPort = Number(process.env.LAB_CONTROL_PORT || 9191);
const extraPort = Number(process.env.LAB_EXTRA_PORT || 9100);

function opensslPath() {
  const candidates = [
    process.env.OPENSSL_BIN,
    'openssl',
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'usr', 'bin', 'openssl.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'usr', 'bin', 'openssl.exe'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // Try the next installed OpenSSL location.
    }
  }
  throw new Error('OpenSSL was not found. Install Git for Windows or set OPENSSL_BIN.');
}

function generateCertificate() {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const executable = opensslPath();
  execFileSync(executable, [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath,
    '-out', certPath,
    '-days', '365',
    '-subj', `/CN=localhost-${Date.now()}`,
    '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
  ], { stdio: 'ignore' });
  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
}

async function control(command) {
  const response = await fetch(`http://127.0.0.1:${controlPort}/${command}`, {
    method: 'POST',
    redirect: 'error',
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Lab command failed (${response.status}): ${body}`);
  }
  console.log(body);
}

async function startLab() {
  const credentials = generateCertificate();
  let extraServer;
  const content = (req, res) => {
    if (req.url === '/.well-known/as-inventory-auth.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(fs.existsSync(proofPath) ? fs.readFileSync(proofPath, 'utf8') : '');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Server: 'AIORI-Lab/1.0' });
    res.end('<!doctype html><html><head><title>AIORI Lab</title></head><body>Authorized inventory lab</body></html>');
  };

  const httpServer = http.createServer(content);
  const httpsServer = https.createServer(credentials, content);
  const controlServer = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ready');
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end('Method not allowed');
      return;
    }
    if (req.url === '/open-port') {
      if (extraServer) {
        res.writeHead(409);
        res.end('Extra port is already open');
        return;
      }
      extraServer = net.createServer((socket) => {
        socket.end('AIORI-LAB-EXTRA-PORT\r\n');
      });
      extraServer.once('error', (err) => {
        extraServer = null;
        res.writeHead(500);
        res.end(err.message);
      });
      extraServer.listen(extraPort, '127.0.0.1', () => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(`Extra TCP port ${extraPort} is open`);
      });
      return;
    }
    if (req.url === '/swap-cert') {
      try {
        httpsServer.setSecureContext(generateCertificate());
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('HTTPS certificate replaced');
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(err.message);
      }
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  });

  const listen = (server, port) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  await Promise.all([
    listen(httpServer, httpPort),
    listen(httpsServer, httpsPort),
    listen(controlServer, controlPort),
  ]);
  console.log(`Lab ready: HTTP 127.0.0.1:${httpPort}, HTTPS 127.0.0.1:${httpsPort}`);

  const close = () => {
    extraServer?.close();
    httpServer.close();
    httpsServer.close();
    controlServer.close();
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

const command = process.argv[2] || 'start';
if (command === 'start') {
  await startLab();
} else if (command === 'open-port') {
  await control('open-port');
} else if (command === 'swap-cert') {
  await control('swap-cert');
} else {
  console.error(`Unknown lab command: ${command}`);
  process.exitCode = 1;
}
