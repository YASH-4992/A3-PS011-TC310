import createApp from '../src/app.js';
import request from 'supertest';
import config from '../src/config/index.js';

/**
 * Step A demonstration script.
 *
 * WHAT IT DOES
 * ------------
 * 1. Logs in (CSRF token from the login page cookie).
 * 2. Creates an IN-SCOPE target   -> expect 201.
 * 3. Creates an OUT-OF-SCOPE target -> expect 400 with a clear error.
 * 4. Prints the most recent audit entries, proving the denied attempt was
 *    written to the audit trail.
 *
 * SAFETY GUARD
 * ------------
 * This script talks to the DEVELOPMENT database (`aiori_asm`). If it is ever
 * run with `NODE_ENV=test` it would pollute the test database, so we refuse
 * to start in that case.
 *
 * CREDENTIALS
 * -----------
 * Read from the environment (`ADMIN_USERNAME` / `ADMIN_PASSWORD`). There is
 * no password hard-coded in this file.
 */
if (process.env.NODE_ENV === 'test') {
  console.error('Refusing to run: this demo must not touch the test database.');
  process.exit(1);
}

(async () => {
  const app = createApp();
  const agent = request.agent(app);

  // 1) GET /login -> receive the CSRF cookie
  const loginPage = await agent.get('/login');
  const csrfToken = (loginPage.headers['set-cookie'] || [])
    .find((c) => c.startsWith('csrf_token='))
    ?.match(/csrf_token=([^;]+)/)[1];
  if (!csrfToken) {
    throw new Error('No CSRF token');
  }

  // 2) POST /login with the CSRF header - credentials from env
  const username = process.env.ADMIN_USERNAME || config.admin.username;
  const password = process.env.ADMIN_PASSWORD || config.admin.password;

  const loginRes = await agent
    .post('/login')
    .set('x-csrf-token', csrfToken)
    .type('form')
    .send({ username, password });
  console.log('Login status:', loginRes.status, '->', loginRes.headers.location);

  // 3) In-scope target (127.0.0.1 is inside SCOPE_CIDRS)
  const inRes = await agent
    .post('/api/targets')
    .set('x-csrf-token', csrfToken)
    .send({ hostname: 'lab', ip: '127.0.0.1', authorized: true });
  console.log('In-scope POST /api/targets ->', inRes.status, inRes.body.id ? 'created' : inRes.body.error);

  // 4) Out-of-scope target (8.8.8.8)
  const outRes = await agent
    .post('/api/targets')
    .set('x-csrf-token', csrfToken)
    .send({ hostname: 'google', ip: '8.8.8.8', authorized: true });
  console.log('Out-of-scope POST /api/targets ->', outRes.status, outRes.body.error);

  // 5) Read back the audit trail
  const auditRes = await agent.get('/api/audit').query({ limit: 5 });
  console.log('Recent audit entries:');
  auditRes.body.forEach((e) => {
    console.log(`  - ${e.event} | ip=${e.ip} | msg=${e.message}`);
  });

  process.exit(0);
})();
