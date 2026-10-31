import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';
import logger from './utils/logger.js';
import config from './config/index.js';
import authRoutes from './routes/auth.js';
import logoutRoutes from './routes/auth.js';
import targetRoutes from './routes/targets.js';
import auditRoutes from './routes/audit.js';
import dashboardRoutes from './routes/dashboard.js';
import { authMiddleware } from './middleware/auth.js';
import { csrfMiddleware, csrfCookieMiddleware } from './middleware/csrf.js';
import { errorMiddleware } from './middleware/error.js';

/**
 * Creates the Express application.
 *
 * Separated from `src/index.js` so integration tests can mount the app
 * without binding a port or connecting to MongoDB.
 *
 * @param {Object} opts - Optional overrides for testing.
 * @param {import('express-session').Store} opts.sessionStore - Custom session store (e.g. MemoryStore for tests).
 * @returns {import('express').Express}
 */
export const createApp = ({ sessionStore } = {}) => {
  const app = express();

  // Trust proxy if behind a load balancer / reverse proxy (needed for
  // `req.ip` and secure cookies to work correctly).
  app.set('trust proxy', config.trustProxy);

  app.set('view engine', 'ejs');
  app.set('views', './views');

  // Structured request logging.
  app.use(pinoHttp({ logger }));

  /**
   * Helmet sets a collection of security headers.
   *
   * WHY THIS IS NOT "XSS PROTECTION": Helmet's legacy `xssFilter` header is
   * ignored by modern browsers. Real XSS defence is:
   *   1. CSP (Content Security Policy) - restricts what scripts/styles can run.
   *   2. Escaped output - EJS auto-escapes `<%= %>` by default.
   *   3. SameSite cookies + CSRF tokens - stop cross-site requests.
   *
   * NOTE: `"'self'"` must use double quotes because the value itself contains
   * a single quote. The lint rule is configured with `avoidEscape: true`, so
   * these double-quoted strings do not violate the single-quote rule.
   */
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
  }));

  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  // Session store - defaults to MongoDB, but can be swapped in tests.
  const store = sessionStore || MongoStore.create({
    mongoUrl: config.mongo.uri,
    dbName: config.mongo.dbName,
    collectionName: 'sessions',
    ttl: config.session.ttlMinutes * 60,
    autoRemove: 'native',
  });

  app.use(session({
    name: config.session.cookieName,
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    store,
    cookie: {
      httpOnly: true,
      secure: config.session.cookieSecure,
      sameSite: 'strict',
      maxAge: config.session.ttlMinutes * 60 * 1000,
    },
  }));

  /**
   * Rate limit the login endpoint.
   *
   * Prevents credential stuffing / brute force. Uses an in-memory store by
   * default (fine for a single-instance demo). For multi-instance prod, swap
   * to Redis (see `express-rate-limit` docs).
   */
  const loginLimiter = rateLimit({
    windowMs: config.loginRateLimit.windowMs,
    max: config.loginRateLimit.maxAttempts,
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers.
    legacyHeaders: false,
    message: { error: 'Too many login attempts, please try again later' },
    // Key by IP; `trust proxy` ensures correct IP behind reverse proxy.
    keyGenerator: (req) => req.ip,
  });

  // The ONLY route reachable without a session.
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Login must be reachable while logged out; rate limited + CSRF cookie.
  app.use('/login', loginLimiter, csrfCookieMiddleware, authRoutes);

  // Everything below requires a session. CSRF is checked for state-changing verbs.
  const protectedMiddleware = [authMiddleware, csrfMiddleware];

  // SYNTAX: `app.use('/api/targets', ...)` mounts a router at a path prefix.
  // IMPORTANT: a mounted router sees the URL RELATIVE to the mount point, so a
  // router mounted at '/api/targets' must define `router.get('/')` (NOT
  // `router.get('/targets')`) to answer GET /api/targets.
  app.use('/logout', ...protectedMiddleware, logoutRoutes);
  // Audit trail - READ-ONLY by design (no POST/PUT/PATCH/DELETE handlers).
  app.use('/api/audit', ...protectedMiddleware, auditRoutes);
  // Target CRUD.
  app.use('/api/targets', ...protectedMiddleware, targetRoutes);
  // UI dashboard - placeholder; real views land in a later slice.
  app.use('/', ...protectedMiddleware, dashboardRoutes);
  // Remaining API route groups are added in subsequent slices:
  // app.use('/api', ...protectedMiddleware, scopeRoutes);
  // app.use('/api', ...protectedMiddleware, scanRoutes);
  // app.use('/api', ...protectedMiddleware, snapshotRoutes);
  // app.use('/api', ...protectedMiddleware, changeRoutes);

  app.use(errorMiddleware);

  return app;
};

export default createApp;
