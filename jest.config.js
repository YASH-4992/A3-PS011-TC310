/**
 * Jest configuration.
 *
 * NOTE ON ESM: this project uses native ES modules (`"type": "module"` in
 * package.json). Jest needs the `--experimental-vm-modules` Node flag to load
 * them, which is why the npm scripts use `cross-env` to set it.
 *
 * Unit tests need no external service. Integration tests may need MongoDB
 * (see docker/docker-compose.yml).
 */
export default {
  testEnvironment: 'node',
  transform: {},
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/index.js'],
  coverageDirectory: 'coverage',
  testTimeout: 20000,
  verbose: true,
  /**
   * SYNTAX: `setupFiles` run BEFORE the test framework and before any test
   * file is imported. We use it to set environment variables, because
   * `src/config/index.js` reads `process.env` at import time - so the
   * secrets must be in place before that module is loaded.
   */
  setupFiles: ['<rootDir>/tests/setup-env.js'],
};
