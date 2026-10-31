import config from '../config/index.js';

/**
 * scanLock.js – a per-target scan lock.
 *
 * WHY
 * ---
 * Two scans of the same host at the same time would (a) double the load on
 * the target and (b) race each other when both try to write a snapshot. So
 * only ONE scan per target may run at a time.
 *
 * HOW
 * ---
 * A simple in-memory Map from targetId -> expiry timestamp. The lock is
 * released when the scan finishes, but it ALSO expires on its own after
 * `SCAN_PER_TARGET_LOCK_MS` milliseconds, so a crashed process can never
 * leave a target permanently unscanable.
 *
 * NOTE: in-memory means the lock is per-process. For a multi-instance
 * deployment this would have to move to MongoDB or Redis. For our
 * single-process demo it is correct.
 */
const locks = new Map();

/**
 * Tries to take the lock for a target.
 *
 * @param {string} targetId
 * @param {number} [ttlMs] - how long the lock stays valid
 * @returns {boolean} true when the lock was taken, false when it was busy
 */
export const acquireScanLock = (targetId, ttlMs = config.scanner.lockMs) => {
  const now = Date.now();
  const existing = locks.get(targetId);

  // An expired lock is treated as free.
  if (existing && existing.expiresAt > now) {
    return false;
  }

  locks.set(targetId, { expiresAt: now + ttlMs });
  return true;
};

/**
 * Releases the lock for a target.
 *
 * @param {string} targetId
 */
export const releaseScanLock = (targetId) => {
  locks.delete(targetId);
};

/**
 * Tells whether a target is currently locked.
 *
 * @param {string} targetId
 * @returns {boolean}
 */
export const isScanLocked = (targetId) => {
  const existing = locks.get(targetId);
  return Boolean(existing && existing.expiresAt > Date.now());
};

export default { acquireScanLock, releaseScanLock, isScanLocked };
