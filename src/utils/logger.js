import mongoose from 'mongoose';
import pino from 'pino';
import config from '../config/index.js';

/**
 * WHY THE TRANSPORT IS CONDITIONAL:
 * pino's `transport` option spawns a worker thread to format the output. In
 * test environments (and in Jest) that worker cannot be resolved reliably, so
 * we fall back to plain JSON. `pino-pretty` is a devDependency, which is
 * exactly right: pretty output is a developer convenience, not something the
 * production container needs.
 *
 * WHY WE ALSO CATCH THE ERROR:
 * A missing transport must never stop the whole application from booting.
 * Logging is a convenience; authentication, scanning and audit are not.
 * If the pretty transport cannot be resolved we fall back to plain JSON
 * output instead of throwing - a broken log format is a much smaller problem
 * than a service that refuses to start.
 */
let logger;

try {
  logger = config.isTest
    ? pino({ level: config.logLevel })
    : pino({
      level: config.logLevel,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    });
} catch {
  // Fall back to plain JSON if the transport target is unavailable
  // (e.g. `npm ci --omit=dev` in a production container).
  logger = pino({ level: config.logLevel });
}

mongoose.set('strictQuery', true);

/**
 * Opens the MongoDB connection.
 *
 * SYNTAX: `await` pauses this function until the promise settles. If the
 * connection fails we log the error and re-throw it, which stops the server
 * from starting with a broken database (fail closed).
 */
export const connectMongo = async () => {
  try {
    await mongoose.connect(config.mongo.uri, { dbName: config.mongo.dbName });
    logger.info('MongoDB connected');
  } catch (err) {
    logger.error({ err }, 'MongoDB connection failed');
    throw err;
  }
};

/**
 * Closes the MongoDB connection cleanly (used on shutdown and in tests).
 */
export const disconnectMongo = async () => {
  await mongoose.connection.close();
};

export default logger;
