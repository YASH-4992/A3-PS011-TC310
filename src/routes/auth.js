import express from 'express';
import { safeEqual } from '../middleware/auth.js';
import config from '../config/index.js';
import { logEvent } from '../services/auditService.js';

const router = express.Router();

/**
 * GET /login
 * Renders the login form with a fresh CSRF token cookie.
 */
router.get('/', (req, res) => {
  if (req.session.user === config.admin.username) {
    return res.redirect('/dashboard');
  }
  res.render('login', { error: null });
});

/**
 * POST /login
 * Validates credentials using constant-time comparison.
 * On success, creates a session and redirects to /dashboard.
 * Audits both success and failure.
 */
router.post('/', async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).render('login', { error: 'Username and password required' });
  }

  const userOk = safeEqual(username, config.admin.username);
  const passOk = safeEqual(password, config.admin.password);

  if (!userOk || !passOk) {
    await logEvent({
      event: 'login_failure',
      actor: username || 'anonymous',
      targetId: null,
      ip: req.ip || '',
      message: `Login failed for username: ${username}`,
    });
    return res.status(401).render('login', { error: 'Invalid credentials' });
  }

  await logEvent({
    event: 'login_success',
    actor: config.admin.username,
    targetId: null,
    ip: req.ip || '',
    message: 'Login successful',
  });

  req.session.user = config.admin.username;
  req.session.save((err) => {
    if (err) {
      return res.status(500).render('login', { error: 'Session error' });
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
