import express from 'express';
import Target from '../models/Target.js';
import Snapshot from '../models/Snapshot.js';
import Change from '../models/Change.js';
import config from '../config/index.js';
import { describeScope } from '../utils/ip.js';
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

const alertTypeFor = (message) => {
  if (/blocked|denied|outside|invalid|failed|refused|unavailable|required/i.test(message)) {
    return 'error';
  }
  if (/started|pending|review|verify|confirm/i.test(message)) {
    return 'warning';
  }
  return 'success';
};

const describeChange = (change) => {
  if (change.type === 'port_opened') {
    return `Port ${change.port} is newly open`;
  }
  if (change.type === 'port_closed') {
    return `Port ${change.port} is no longer open`;
  }
  if (change.type === 'cert_changed') {
    return 'The HTTPS certificate changed';
  }
  if (change.type === 'banner_changed') {
    return `The service banner changed${change.port ? ` on port ${change.port}` : ''}`;
  }
  if (change.type === 'host_added') {
    return 'A host was newly observed';
  }
  if (change.type === 'host_removed') {
    return 'A previously observed host is no longer present';
  }
  return change.details;
};

const renderPage = async (req, res, view, title, data) => {
  const message = typeof req.query.message === 'string' ? req.query.message.slice(0, 500) : '';
  const shared = {
    title,
    activePage: view,
    username: req.session.user,
    csrfToken: csrfTokenFromRequest(req),
    message,
    alertType: alertTypeFor(message),
  };
  const page = await renderView(res, view, { ...shared, ...data });
  const layout = await renderView(res, 'layout', shared);
  res.type('html').send(layout.replace('<!--PAGE_CONTENT-->', page));
};

const loadInventory = async () => {
  const targets = await Target.find().sort({ createdAt: -1 }).lean();
  return Promise.all(targets.map(async (target) => {
    const [latestSnapshot, successfulScans] = await Promise.all([
      Snapshot.findOne({ target: target._id, status: 'completed' }).sort({ createdAt: -1 }).lean(),
      Snapshot.countDocuments({ target: target._id, status: 'completed' }),
    ]);
    return { ...target, latestSnapshot, successfulScans };
  }));
};

router.get('/dashboard', async (req, res) => {
  const [targets, changes24h, completedScanCount] = await Promise.all([
    loadInventory(),
    Change.countDocuments({ createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
    Snapshot.countDocuments({ status: 'completed' }),
  ]);
  const openPorts = targets.reduce((count, target) => count + (target.latestSnapshot?.ports?.length || 0), 0);
  const changeRecords = await Change.find().sort({ createdAt: -1 }).limit(200).lean();
  const steps = [
    { title: 'Add a target', done: targets.length > 0, detail: `${targets.length} target(s) added` },
    {
      title: 'Confirm authorization',
      done: targets.some((target) => Boolean(target.confirmedAt)),
      detail: `${targets.filter((target) => Boolean(target.confirmedAt)).length} target(s) confirmed`,
    },
    {
      title: 'Verify proof',
      done: targets.some((target) => Boolean(target.proofVerifiedAt)),
      detail: `${targets.filter((target) => Boolean(target.proofVerifiedAt)).length} target(s) proof verified`,
    },
    {
      title: 'Run a scan',
      done: completedScanCount > 0,
      detail: `${completedScanCount} successful scan(s)`,
    },
    {
      title: 'Run a second scan and review changes',
      done: targets.some((target) => target.successfulScans > 1) && changeRecords.length > 0,
      detail: `${changeRecords.length} change(s) available to review`,
    },
  ];
  await renderPage(req, res, 'overview', 'Overview', {
    targets,
    summary: {
      targets: targets.length,
      confirmed: targets.filter((target) => Boolean(target.confirmedAt)).length,
      openPorts,
      changes24h,
    },
    steps,
    scopeText: describeScope(config.scopeCidrs),
  });
});

router.get('/dashboard/inventory', async (req, res) => {
  const targets = await loadInventory();
  await renderPage(req, res, 'inventory', 'Inventory', { targets });
});

router.get('/dashboard/changes', async (req, res) => {
  const changes = await Change.find().sort({ createdAt: -1 }).limit(200).lean();
  await renderPage(req, res, 'changes', 'Changes', { changes, describeChange });
});

router.get('/dashboard/audit', async (req, res) => {
  const events = await listEvents({ limit: 200 });
  await renderPage(req, res, 'audit', 'Audit log', { events });
});

router.get('/dashboard/how-it-works', async (req, res) => {
  await renderPage(req, res, 'how-it-works', 'How it works', {});
});

export default router;
