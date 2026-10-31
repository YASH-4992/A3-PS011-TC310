import { afterAll, beforeAll, beforeEach, describe, test, expect } from '@jest/globals';
import request from 'supertest';
import createApp from '../../src/app.js';
import Target from '../../src/models/Target.js';
import Audit from '../../src/models/Audit.js';
import { connectMongo, disconnectMongo } from '../../src/utils/logger.js';
import config from '../../src/config/index.js';

describe('Target routes', () => {
  let app;
  let agent;
  let csrfToken;

  beforeAll(async () => {
    await connectMongo();
    app = createApp();
  });

  beforeEach(async () => {
    // Clean collections before each test for isolation
    await Promise.all([
      Target.deleteMany({}),
      Audit.deleteMany({}),
    ]);

    agent = request.agent(app);

    // GET login page to receive CSRF cookie
    const loginPage = await agent.get('/login');
    csrfToken = (loginPage.headers['set-cookie'] || [])
      .find((c) => c.startsWith('csrf_token='))
      ?.match(/csrf_token=([^;]+)/)[1];
    if (!csrfToken) {
      throw new Error('No CSRF token');
    }

    // Login with the agent (preserves session cookie)
    await agent
      .post('/login')
      .set('x-csrf-token', csrfToken)
      .type('form')
      .send({ username: config.admin.username, password: config.admin.password });
  });

  afterAll(async () => {
    await Promise.all([Target.deleteMany({}), Audit.deleteMany({})]);
    await disconnectMongo();
  });

  test('POST /api/targets in-scope -> 201', async () => {
    const res = await agent
      .post('/api/targets')
      .set('x-csrf-token', csrfToken)
      .send({ hostname: 'in-scope', ip: '127.0.0.1', authorized: true });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.hostname).toBe('in-scope');
    expect(res.body.status).toBe('pending');
  });

  test('POST /api/targets out-of-scope -> 400 with clear error', async () => {
    const res = await agent
      .post('/api/targets')
      .set('x-csrf-token', csrfToken)
      .send({ hostname: 'out-of-scope', ip: '8.8.8.8', authorized: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/outside the authorized scope/i);
  });

  test('POST /api/targets invalid body -> 400', async () => {
    const res = await agent
      .post('/api/targets')
      .set('x-csrf-token', csrfToken)
      .send({ hostname: 'bad', ip: 'not-an-ip', authorized: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid ip/i);
  });

  test('GET /api/targets without session -> 401', async () => {
    const res = await request(app).get('/api/targets');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  test('Out-of-scope attempt writes audit entry', async () => {
    const auditBefore = await Audit.countDocuments({ event: 'target_out_of_scope' });
    await agent
      .post('/api/targets')
      .set('x-csrf-token', csrfToken)
      .send({ hostname: 'oos2', ip: '8.8.4.4', authorized: true });
    const auditAfter = await Audit.countDocuments({ event: 'target_out_of_scope' });
    expect(auditAfter).toBe(auditBefore + 1);
  });

  test('authorization confirmation requires the checkbox and stores operator facts', async () => {
    const created = await agent
      .post('/api/targets')
      .set('x-csrf-token', csrfToken)
      .send({ hostname: 'confirm-lab', ip: '127.0.0.1', authorized: true });

    const denied = await agent
      .post(`/api/targets/${created.body.id}/confirm`)
      .set('x-csrf-token', csrfToken)
      .send({});
    expect(denied.status).toBe(400);

    const confirmed = await agent
      .post(`/api/targets/${created.body.id}/confirm`)
      .set('x-csrf-token', csrfToken)
      .send({ authorized: true });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.confirmedBy).toBe(config.admin.username);
    expect(confirmed.body.confirmedAt).toBeTruthy();
  });

  test('dashboard pages render inventory with escaped content and authenticated navigation', async () => {
    const created = await agent
      .post('/api/targets')
      .set('x-csrf-token', csrfToken)
      .send({
        hostname: 'escaped-lab',
        ip: '127.0.0.1',
        label: '<script>alert(1)</script>',
        authorized: true,
      });
    expect(created.status).toBe(201);

    const inventory = await agent.get('/dashboard');
    expect(inventory.status).toBe(200);
    expect(inventory.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(inventory.text).not.toContain('<script>alert(1)</script>');
    expect((await agent.get('/dashboard/changes')).status).toBe(200);
    expect((await agent.get('/dashboard/audit')).status).toBe(200);
  });
});