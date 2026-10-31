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

describe('Auth middleware', () => {
  let app;
  let agent;
  let csrfToken;

  beforeAll(async () => {
    app = await makeApp();
    agent = request.agent(app);
    const loginPage = await agent.get('/login');
    csrfToken = loginPage.headers['set-cookie']
      .find((cookie) => cookie.startsWith('csrf_token='))
      .match(/csrf_token=([^;]+)/)[1];
  });

  afterAll(async () => {
    await Audit.deleteMany({});
    await disconnectMongo();
  });

  test('Protected API route without session returns 401 JSON', async () => {
    // /api/targets is behind auth middleware - should return 401 for unauthenticated API request
    const res = await request(app).get('/api/targets');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  test('Health endpoint is open', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
  });

  test('GET /login serves the login form', async () => {
    const res = await request(app).get('/login');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  test('Protected UI route without session redirects to /login', async () => {
    const res = await request(app).get('/dashboard');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  test('Login with wrong password is rejected', async () => {
    const res = await agent
      .post('/login')
      .set('x-csrf-token', csrfToken)
      .type('form')
      .send({ username: 'admin', password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  test('Login with correct password creates a session', async () => {
    const res = await agent
      .post('/login')
      .set('x-csrf-token', csrfToken)
      .type('form')
      .send({ username: config.admin.username, password: config.admin.password });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/dashboard');
    // The session cookie must be set (HttpOnly, SameSite=Strict)
    const cookies = res.headers['set-cookie'] || [];
    expect(cookies.some(c => c.startsWith('asm.sid='))).toBe(true);
  });
});