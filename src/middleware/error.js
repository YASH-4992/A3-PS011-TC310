import config from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * Global error handler.
 *
 * SYNTAX: Express identifies an error handler by its FOUR parameters
 * `(err, req, res, next)`. Even though `next` is unused, it MUST be declared –
 * if you omit it, Express treats the function as ordinary middleware and the
 * error will never reach it.
 *
 * WHY: every error in the app ends up here, so we log it in one consistent
 * format and we never leak a stack trace to the client in production.
 */
export const errorMiddleware = (err, req, res, _next) => {
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');

  // `err.statusCode` lets a route throw e.g. `httpError(404, 'Not found')`.
  const status = err.statusCode || 500;

  // In production the client gets a generic message; in dev we show the real
  // reason so the developer can debug quickly.
  const message = config.isProduction ? 'Internal Server Error' : err.message;

  res.status(status).json({ error: message });
};

export default errorMiddleware;
