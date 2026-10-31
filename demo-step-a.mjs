import createApp from './src/app.js';
import request from 'supertest';
import config from './src/config/index.js';

const app = createApp();

// Helper: pull the CSRF token out of the `set-cookie` array.
const getCsrfToken = (setCookie) => {
  const header = (setCookie || []).find((c) => c.startsWith('csrf_token=')) || '';
  const match = header.match(/csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
};

// One agent keeps the session + CSRF cookies across all requests.
const agent = request.agent(app);

// 1) GET /login -> receive the CSRF cookie
const loginPage = await agent.get('/login');
const csrfToken = getCsrfToken(loginPage.headers['set-cookie']);

// 2) POST /login with the CSRF header
const loginRes = await agent
  .post('/login')
  .set('x-csrf-token', csrfToken)
  .type('form')
  .send({ username: config.admin.username, password: config.admin.password });
console.log('Login status:', loginRes.status, '->', loginRes.headers.location);

// 3) In-scope target (127.0.0.1 is inside SCOPE_CIDRS)
const inRes = await agent
  .post('/api/targets')
  .set('x-csrf-token', csrfToken)
  .send({ hostname: 'lab', ip: '127.0.0.1' });
console.log('In-scope POST /api/targets ->', inRes.status, inRes.body.id ? 'created' : inRes.body.error);

// 4) Out-of-scope target (8.8.8.8)
const outRes = await agent
  .post('/api/targets')
  .set('x-csrf-token', csrfToken)
  .send({ hostname: 'google', ip: '8.8.8.8' });
console.log('Out-of-scope POST /api/targets ->', outRes.status, outRes.body.error);

// 5) Read back the audit trail
const auditRes = await agent.get('/api/audit').query({ limit: 5 });
console.log('Recent audit entries:');
auditRes.body.forEach((e) => {
  console.log(`  - ${e.event} | ip=${e.ip} | msg=${e.message}`);
});

process.exit(0);
