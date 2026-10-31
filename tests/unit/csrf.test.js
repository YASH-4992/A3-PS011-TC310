import { afterAll } from '@jest/globals';
import request from 'supertest';
import createApp from '../../src/app.js';
import config from '../../src/config/index.js';
import { disconnectMongo } from '../../src/utils/logger.js';
import Audit from '../../src/models/Audit.js';

/**
 * Helper to create an app instance with an in‑memory session store.
 */
async function makeApp() {
  const { MemoryStore } = await import('express-session');
  const store = new MemoryStore();
  return createApp({ sessionStore: store });
}

describe('CSRF middleware', () => {
  let app;

  beforeAll(async () => {
    app = await makeApp();
  });

  afterAll(async () => {
    await Audit.deleteMany({});
    await disconnectMongo();
  });

  test('GET /login sets CSRF cookie', async () => {
    const res = await request(app).get('/login');
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeDefined();
    const cookie = res.headers['set-cookie'].find(c => c.startsWith('csrf_token='));
    expect(cookie).toBeDefined();
  });

  test('POST without CSRF token on protected route returns 403', async () => {
    const agent = request.agent(app);
    const loginPage = await agent.get('/login');
    const csrfToken = loginPage.headers['set-cookie']
      .find((cookie) => cookie.startsWith('csrf_token='))
      .match(/csrf_token=([^;]+)/)[1];

    const loginRes = await agent
      .post('/login')
      .set('x-csrf-token', csrfToken)
      .type('form')
      .send({ username: config.admin.username, password: config.admin.password });
    expect(loginRes.status).toBe(302);

    // Now POST to a protected route WITHOUT a CSRF token -> 403
    const res = await agent.post('/logout').send({});
    expect(res.status).toBe(403);
  });
});