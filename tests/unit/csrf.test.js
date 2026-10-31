import request from 'supertest';
import createApp from '../../src/app.js';

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

  test('GET /login sets CSRF cookie', async () => {
    const res = await request(app).get('/login');
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeDefined();
    const cookie = res.headers['set-cookie'].find(c => c.startsWith('csrf_token='));
    expect(cookie).toBeDefined();
  });

  test('POST without CSRF token on protected route returns 403', async () => {
    // First log in to get a valid session cookie
    const loginRes = await request(app)
      .post('/login')
      .type('form')
      .send({ username: 'admin', password: 'strongpassword123' });
    expect(loginRes.status).toBe(302);

    const agent = request.agent(app);

    // Log in through the agent so the session cookie is kept
    await agent
      .post('/login')
      .type('form')
      .send({ username: 'admin', password: 'strongpassword123' });

    // Now POST to a protected route WITHOUT a CSRF token -> 403
    const res = await agent.post('/logout').send({});
    expect(res.status).toBe(403);
  });
});