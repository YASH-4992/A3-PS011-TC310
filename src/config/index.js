import { z } from 'zod';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Environment configuration.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every setting the app reads from the environment is validated here, exactly
 * once, at boot. Two rules drive the design:
 *
 *  1. FAIL CLOSED. If a required secret is missing, weak, or still the
 *     built-in development default, the process refuses to start. A scanning
 *     tool that starts without real credentials is a tool that can be misused.
 *
 *  2. SCAN NOTHING BY DEFAULT. `SCAN_PORTS` and `SCOPE_CIDRS` both default to
 *     empty. A fresh install therefore has no ports to probe and no address
 *     range it is even allowed to touch.
 *
 * NOTE: Authorization state (confirmedBy/At, proofNonce, proofVerifiedAt,
 * status) is deliberately NOT here. Those are per-target facts that live in
 * the database on the Target model, not deployment-wide settings.
 */

/**
 * Loads a local `.env` file into `process.env` – so the developer never has to
 * export variables by hand.
 *
 * SYNTAX: `fs.existsSync(path)` checks for a file without throwing if it is
 * missing. `fs.readFileSync(file, { encoding: 'utf8' })` reads the whole file
 * as one string. `split(/\n/)` splits it into lines (the regex matches any
 * line break). Destructuring `const [key, ...rest] = line.split('=')` takes
 * the first piece as the key and keeps every later piece in `rest` – that way
 * a value containing `=` (like a base64 secret) is not truncated.
 *
 * We only set a variable if it is NOT already defined, so real environment
 * variables (set by the shell, Docker, or CI) always win over the file.
 */
const envFile = path.resolve('.env');
if (fs.existsSync(envFile)) {
  const envContent = fs.readFileSync(envFile, { encoding: 'utf8' });
  envContent.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }
    const [key, ...rest] = trimmed.split('=');
    const value = rest.join('=');
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  });
}

/**
 * SYNTAX: `z.string().default('x')` — a Zod schema that accepts a string and
 * substitutes 'x' when the variable is absent. `.transform()` converts the
 * validated value into whatever shape the rest of the app wants.
 */
const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['true', '1', 'yes', 'on'].includes(v.toLowerCase())));

/**
 * SYNTAX: comma-separated string -> array of port numbers.
 * e.g. "80,443,8080" becomes [80, 443, 8080].
 */
const portList = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => Number.parseInt(p, 10))
      .filter((p) => Number.isInteger(p) && p > 0 && p <= 65535),
  );

/**
 * SYNTAX: comma-separated string -> array of CIDR/IP strings.
 */
const cidrList = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean),
  );

/** The built-in values that must never survive into production. */
const DEV_SESSION_SECRET = 'change-me-in-production-min-16-chars';
const DEV_ADMIN_PASSWORD = 'change-me-in-production-min-8-chars';
const DEV_ADMIN_USERNAME = 'admin';

/**
 * A secret is "weak" if it is the shipped placeholder, or if it is short
 * enough that brute-forcing it is trivial.
 */
function isWeakSecret(value, minLength) {
  if (!value) {
    return true;
  }
  if (value === DEV_SESSION_SECRET || value === DEV_ADMIN_PASSWORD) {
    return true;
  }
  if (value.length < minLength) {
    return true;
  }
  // A value made of a single repeated character is not a secret.
  if (/^(.)\1+$/.test(value)) {
    return true;
  }
  return false;
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    TRUST_PROXY: booleanish.default(false),

    MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/aiori_asm'),
    MONGODB_DB_NAME: z.string().min(1).default('aiori_asm'),

    SESSION_SECRET: z.string().default(DEV_SESSION_SECRET),
    SESSION_COOKIE_NAME: z.string().min(1).default('asm.sid'),
    SESSION_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),

    ADMIN_USERNAME: z.string().min(1).default(DEV_ADMIN_USERNAME),
    ADMIN_PASSWORD: z.string().default(DEV_ADMIN_PASSWORD),

    // ---- Login rate limiting ------------------------------------------
    // Window is 15 minutes by default; max is 1 hour.
    LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(3600000).default(900000),
    LOGIN_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(10),

    // ---- Scanner -------------------------------------------------------
    // Empty by default: a fresh install scans nothing (Phase 1 "good" #1).
    SCAN_PORTS: portList,
    SCAN_MAX_CONCURRENT: z.coerce.number().int().min(1).max(64).default(4),
    SCAN_INTER_PORT_DELAY_MS: z.coerce.number().int().min(0).max(60000).default(150),
    SCAN_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(200).max(60000).default(2000),
    SCAN_BANNER_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(1500),
    SCAN_BANNER_MAX_BYTES: z.coerce.number().int().min(32).max(8192).default(512),
    SCAN_PER_TARGET_LOCK_MS: z.coerce.number().int().min(1000).max(3600000).default(300000),

    // ---- Certificates --------------------------------------------------
    CERT_EXPIRY_THRESHOLD_DAYS: z.coerce.number().int().min(1).max(365).default(21),

    // ---- Authorization / proof -----------------------------------------
    // true  -> a target must be `proof_verified` before it can be scanned.
    // false -> `confirmed` is enough (used only if the proof-file check is cut).
    REQUIRE_PROOF_BEFORE_SCAN: booleanish.default(true),
    PROOF_PATH_TEMPLATE: z.string().min(1).default('/.well-known/{nonce}.txt'),
    PROOF_HTTP_TIMEOUT_MS: z.coerce.number().int().min(200).max(30000).default(3000),

    // ---- Scheduler ------------------------------------------------------
    CRON_ENABLED: booleanish.default(false),
    CRON_SCHEDULE: z.string().min(1).default('0 */6 * * *'),

    // ---- Alerts (email) --------------------------------------------------
    SMTP_HOST: z.string().default(''),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
    SMTP_SECURE: booleanish.default(false),
    SMTP_USER: z.string().default(''),
    SMTP_PASSWORD: z.string().default(''),
    SMTP_FROM: z.string().default('aiori-monitor@lab.local'),
    ALERT_EMAIL_TO: z.string().default(''),

    // ---- Scope ----------------------------------------------------------
    // HARD OUTER BOUNDARY. A target added in the database must resolve to IPs
    // inside one of these ranges. See DECISIONS.md for the full reasoning.
    SCOPE_CIDRS: cidrList,

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  })
  .superRefine((env, ctx) => {
    // These three checks run in EVERY environment, not just production: a
    // weak password on a laptop demo is still a weak password.
    if (isWeakSecret(env.SESSION_SECRET, 16)) {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_SECRET'],
        message: 'SESSION_SECRET is missing, too short (<16 chars), or still the default placeholder',
      });
    }
    if (isWeakSecret(env.ADMIN_PASSWORD, 8)) {
      ctx.addIssue({
        code: 'custom',
        path: ['ADMIN_PASSWORD'],
        message: 'ADMIN_PASSWORD is missing, too short (<8 chars), or still the default placeholder',
      });
    }
    if (env.ADMIN_USERNAME === DEV_ADMIN_USERNAME && env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['ADMIN_USERNAME'],
        message: 'ADMIN_USERNAME must be changed from the default in production',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Invalid environment configuration:\n${details}\n\nCopy .env.example to .env and set real values.`);
  throw new Error('Invalid environment configuration');
}

const env = parsed.data;

export const config = Object.freeze({
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  trustProxy: env.TRUST_PROXY,

  mongo: {
    uri: env.MONGODB_URI,
    dbName: env.MONGODB_DB_NAME,
  },

  session: {
    secret: env.SESSION_SECRET,
    cookieName: env.SESSION_COOKIE_NAME,
    ttlMinutes: env.SESSION_TTL_MINUTES,
    // Secure cookies break plain-HTTP local demos, so it follows NODE_ENV.
    cookieSecure: env.NODE_ENV === 'production',
  },

  admin: {
    username: env.ADMIN_USERNAME,
    password: env.ADMIN_PASSWORD,
  },

  loginRateLimit: {
    windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
    maxAttempts: env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  },

  scanner: {
    ports: Object.freeze(env.SCAN_PORTS),
    maxConcurrent: env.SCAN_MAX_CONCURRENT,
    interPortDelayMs: env.SCAN_INTER_PORT_DELAY_MS,
    connectTimeoutMs: env.SCAN_CONNECT_TIMEOUT_MS,
    bannerTimeoutMs: env.SCAN_BANNER_TIMEOUT_MS,
    bannerMaxBytes: env.SCAN_BANNER_MAX_BYTES,
    lockMs: env.SCAN_PER_TARGET_LOCK_MS,
  },

  cert: {
    expiryThresholdDays: env.CERT_EXPIRY_THRESHOLD_DAYS,
  },

  proof: {
    requiredBeforeScan: env.REQUIRE_PROOF_BEFORE_SCAN,
    pathTemplate: env.PROOF_PATH_TEMPLATE,
    httpTimeoutMs: env.PROOF_HTTP_TIMEOUT_MS,
  },

  scheduler: {
    enabled: env.CRON_ENABLED,
    schedule: env.CRON_SCHEDULE,
  },

  smtp: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.SMTP_FROM,
    to: env.ALERT_EMAIL_TO,
    enabled: env.SMTP_HOST.length > 0 && env.ALERT_EMAIL_TO.length > 0,
  },

  /**
   * The hard outer boundary of what this tool may ever touch.
   * Empty by default -> even a confirmed target cannot be scanned until an
   * operator defines at least one range here.
   */
  scopeCidrs: Object.freeze(env.SCOPE_CIDRS),

  logLevel: env.LOG_LEVEL,
});

/**
 * SYNTAX: a random hex string, used as a CSRF / proof nonce.
 * `crypto.randomBytes(32)` returns 32 random bytes; `.toString('hex')` renders
 * them as 64 hex characters.
 */
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

export default config;
