import crypto from 'crypto';
import config from '../config/index.js';

/**
 * Constant-time string comparison.
 *
 * Used for credential checks so that a wrong-length password does not fail
 * faster than a wrong-content one (basic timing-attack mitigation).
 */
export function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a), 'utf8');
  const bBuf = Buffer.from(String(b), 'utf8');

  if (aBuf.length !== bBuf.length) {
    // Compare equal-length buffers so the timing does not depend on length.
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Authentication middleware.
 *
 * Requires a valid session (`req.session.user`). The only route exempt from
 * this is `/health`, which is mounted before this middleware in `src/app.js`.
 *
 * We distinguish API routes (return 401 JSON) from UI routes (redirect to /login)
 * by checking the path prefix.
 *
 * WHY `req.originalUrl` AND NOT `req.path`:
 * When middleware is mounted with `app.use('/api', ...)`, Express rewrites
 * `req.url` to the part *after* the mount point, so `req.path` becomes
 * `/targets` instead of `/api/targets`. `req.originalUrl` always holds the
 * full path as the client sent it, which is what we need to recognise an API
 * request.
 */
export const authMiddleware = (req, res, next) => {
  if (req.session && req.session.user === config.admin.username) {
    return next();
  }
  // API routes under /api return 401 JSON; everything else (UI) redirects.
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return res.redirect('/login');
};

export default authMiddleware;
