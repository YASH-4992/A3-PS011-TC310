import express from 'express';
import { z } from 'zod';
import { safeEqual } from '../middleware/auth.js';
import config from '../config/index.js';
import { logEvent } from '../services/auditService.js';

const router = express.Router();
const LoginSchema = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(1024),
});

/**
 * GET /login
 * Renders the login form with a fresh CSRF token cookie.
 */
router.get('/', (req, res) => {
  if (req.session.user === config.admin.username) {
    return res.redirect('/dashboard');
  }
  res.render('login', { error: null, csrfToken: res.locals.csrfToken || '' });
});

/**
 * POST /login
 * Validates credentials using constant-time comparison.
 * On success, creates a session and redirects to /dashboard.
 * Audits both success and failure.
 */
router.post('/', async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    const auditDoc = await logEvent({
      event: 'login_failure',
      actor: typeof req.body?.username === 'string' ? req.body.username.slice(0, 128) : 'anonymous',
      ip: req.ip || '',
      message: 'Login denied: invalid input',
    });
    if (!auditDoc) {
      return res.status(503).render('login', {
        error: 'Audit trail unavailable; login attempt could not be recorded.',
        csrfToken: res.locals.csrfToken || '',
      });
    }
    return res.status(400).render('login', {
      error: 'Username and password are required.',
      csrfToken: res.locals.csrfToken || '',
    });
  }
  const { username, password } = parsed.data;

  const userOk = safeEqual(username, config.admin.username);
  const passOk = safeEqual(password, config.admin.password);

  if (!userOk || !passOk) {
    const auditDoc = await logEvent({
      event: 'login_failure',
      actor: username || 'anonymous',
      targetId: null,
      ip: req.ip || '',
      message: `Login failed for username: ${username}`,
    });
    if (!auditDoc) {
      return res.status(503).render('login', {
        error: 'Audit trail unavailable; login attempt could not be recorded.',
        csrfToken: res.locals.csrfToken || '',
      });
    }
    return res.status(401).render('login', {
      error: 'Invalid credentials',
      csrfToken: res.locals.csrfToken || '',
    });
  }

  const auditDoc = await logEvent({
    event: 'login_success',
    actor: config.admin.username,
    targetId: null,
    ip: req.ip || '',
    message: 'Login successful',
  });
  if (!auditDoc) {
    return res.status(503).render('login', {
      error: 'Audit trail unavailable; login refused.',
      csrfToken: res.locals.csrfToken || '',
    });
  }

  req.session.user = config.admin.username;
  req.session.save((err) => {
    if (err) {
      return res.status(500).render('login', {
        error: 'Session error',
        csrfToken: res.locals.csrfToken || '',
      });
    }
    res.redirect('/dashboard');
  });
});

/**
 * POST /logout
 * Destroys the session and clears cookies.
 */
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    res.clearCookie(config.session.cookieName);
    res.clearCookie('csrf_token');
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.redirect('/login');
  });
});

export default router;
