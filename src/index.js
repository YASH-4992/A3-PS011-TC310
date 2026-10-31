import config from './config/index.js';
import createApp from './app.js';

/**
 * Server entry‑point.
 *
 * - Connects to MongoDB.
 * - Creates the Express app via `createApp()` (so tests can import the app
 *   without opening a network port).
 * - Starts listening on the configured port.
 * - Logs a concise start‑up line – useful for CI / monitoring.
 *
 * SYNTAX: `await import('./utils/logger.js')` is a *dynamic import*. We use it
 * here so the logger module (and therefore the config validation) is loaded
 * only at start‑up, not when this file is first parsed.
 */
const start = async () => {
  const { connectMongo } = await import('./utils/logger.js');
  await connectMongo();

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`Server listening on http://localhost:${config.port}`);
  });
};

start().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
