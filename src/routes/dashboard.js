import express from 'express';
import Target from '../models/Target.js';
import Snapshot from '../models/Snapshot.js';
import Change from '../models/Change.js';
import { listEvents } from '../services/auditService.js';

const router = express.Router();

const csrfTokenFromRequest = (req) => {
  const cookie = (req.headers.cookie || '').split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('csrf_token='));
  return cookie ? decodeURIComponent(cookie.slice('csrf_token='.length)) : '';
};

const renderView = (res, view, locals) => new Promise((resolve, reject) => {
  res.render(view, locals, (error, html) => {
    if (error) {
      reject(error);
      return;
    }
    resolve(html);
  });
});

const renderPage = async (req, res, view, title, data) => {
  const shared = {
    title,
    activePage: view,
    username: req.session.user,
    csrfToken: csrfTokenFromRequest(req),
    message: typeof req.query.message === 'string' ? req.query.message : '',
  };
  const page = await renderView(res, view, { ...shared, ...data });
  const layout = await renderView(res, 'layout', shared);
  res.type('html').send(layout.replace('<!--PAGE_CONTENT-->', page));
};

router.get('/dashboard', async (req, res) => {
  const targets = await Target.find().sort({ createdAt: -1 }).lean();
  const inventory = await Promise.all(targets.map(async (target) => ({
    ...target,
    latestSnapshot: await Snapshot.findOne({ target: target._id, status: 'completed' })
      .sort({ createdAt: -1 })
      .lean(),
  })));
  await renderPage(req, res, 'inventory', 'Inventory', { targets: inventory });
});

router.get('/dashboard/changes', async (req, res) => {
  const changes = await Change.find().sort({ createdAt: -1 }).limit(200).lean();
  await renderPage(req, res, 'changes', 'Changes', { changes });
});

router.get('/dashboard/audit', async (req, res) => {
  const events = await listEvents({ limit: 200 });
  await renderPage(req, res, 'audit', 'Audit log', { events });
});

export default router;
