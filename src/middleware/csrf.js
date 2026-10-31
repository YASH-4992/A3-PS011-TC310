import crypto from 'crypto';
import config from '../config/index.js';

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) {
      continue;
    }
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}

function tokensMatch(a, b) {
  if (!a || !b) { return false; }
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  if (aBuf.length !== bBuf.length) {
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Sets a CSRF cookie on safe methods if missing.
 * Runs early so the token is available for forms/HTMX.
 */
export const csrfCookieMiddleware = (req, res, next) => {
  const cookieName = 'csrf_token';
  const cookieToken = readCookie(req, cookieName);

  if (SAFE_METHODS.includes(req.method) && !cookieToken) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie(cookieName, token, {
      httpOnly: false,
      secure: config.session.cookieSecure,
      sameSite: 'strict',
      maxAge: config.session.ttlMinutes * 60 * 1000,
      path: '/',
    });
  }
  next();
};

/**
 * Validates CSRF token on state-changing methods.
 */
export const csrfMiddleware = (req, res, next) => {
  const cookieName = 'csrf_token';
  const cookieToken = readCookie(req, cookieName);

  if (SAFE_METHODS.includes(req.method)) {
    return next();
  }

  const headerToken = req.get('x-csrf-token');
  const bodyToken = req.body?._csrf;

  if (!tokensMatch(cookieToken, headerToken) && !tokensMatch(cookieToken, bodyToken)) {
    req.app?.locals?.logger?.warn?.({ path: req.path, method: req.method }, 'CSRF validation failed');
    return res.status(403).json({ error: 'Forbidden: invalid CSRF token' });
  }

  next();
};

export default csrfMiddleware;
