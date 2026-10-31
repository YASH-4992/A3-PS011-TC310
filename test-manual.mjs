import createApp from './src/app.js';
import request from 'supertest';
import config from './src/config/index.js';

(async () => {
  const app = createApp();
  const loginPage = await request(app).get('/login');
  const csrf = (loginPage.headers['set-cookie']||[]).find(c=>c.startsWith('csrf_token='))?.match(/csrf_token=([^;]+)/)[1];
  const loginRes = await request(app).post('/login').set('x-csrf-token', csrf).type('form').send({username:config.admin.username,password:config.admin.password});
  console.log('login',loginRes.status);
  const agent = request.agent(app);
  // reuse cookies by setting cookie header
  const cookie = loginRes.headers['set-cookie'];
  const inRes = await agent.post('/api/targets').set('Cookie', cookie).set('x-csrf-token', csrf).send({hostname:'lab',ip:'127.0.0.1'});
  console.log('in',inRes.status,inRes.body);
})();
