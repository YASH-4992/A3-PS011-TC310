/**
 * Test environment setup.
 *
 * SYNTAX: this file runs BEFORE any test module is imported (see
 * `setupFiles` in jest.config.js). `src/config/index.js` reads
 * `process.env` at import time, so every value it needs must be set here
 * first.
 *
 * WHY WE SET BOTH THE URI *AND* THE DB NAME
 * ------------------------------------------
 * `src/config/index.js` calls
 * `mongoose.connect(uri, { dbName })`. The `dbName` option WINS over the
 * database path inside the URI. If we only set `MONGODB_URI` here, the `.env`
 * file (loaded later, in the config module) would supply
 * `MONGODB_DB_NAME=aiori_asm` and every test would write into the
 * DEVELOPMENT database. Setting both keeps tests in `aiori_test` and leaves
 * the dev data alone.
 */
process.env.NODE_ENV = 'test';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'strongpassword123';
process.env.SESSION_SECRET = 'supersecretkeywith16chars';
process.env.SESSION_TTL_MINUTES = '60';
process.env.PORT = '3001';

// Test database - NEVER the development database.
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/aiori_test';
process.env.MONGODB_DB_NAME = 'aiori_test';

// Quieter logs while testing.
process.env.LOG_LEVEL = 'error';

// For the scope gate: in tests we use 127.0.0.1/32 as the authorized range.
process.env.SCOPE_CIDRS = '127.0.0.1/32';
