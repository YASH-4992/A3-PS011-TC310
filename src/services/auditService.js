import mongoose from 'mongoose';
import Audit from '../models/Audit.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * Audit service – INSERT ONLY.
 *
 * WHY INSERT-ONLY
 * ---------------
 * An audit log is only trustworthy if nobody can quietly edit it. This module
 * deliberately exposes exactly ONE write operation (`logEvent`, which calls
 * `Audit.create`) and one read operation (`listEvents`). There is NO
 * `update`, NO `delete`, and NO `findOneAndUpdate` anywhere in this file or
 * in the API that uses it. Tampering with the audit trail would require
 * direct database access, which is a different (and logged) class of attack.
 *
 * WHY WE NEVER THROW ON AUDIT FAILURE
 * ----------------------------------
 * If the audit write fails we log the error loudly but do NOT crash the
 * request. The alternative – refusing to act because the audit log is down –
 * would turn a logging outage into an outage of the whole tool. The error is
 * still visible in the structured logs.
 */

/**
 * Records one audit event.
 *
 * SYNTAX: `await` pauses the function until the database write settles.
 * Because every call site awaits this, the audit entry is committed BEFORE
 * the HTTP response is sent – the log can never lag behind the action.
 *
 * @param {Object} entry
 * @param {string} entry.event   - one of the enum values in the Audit schema
 * @param {string} entry.actor   - who performed the action
 * @param {string} [entry.targetId] - optional Target id
 * @param {string} [entry.ip]    - optional IP address involved
 * @param {string} [entry.message] - optional human-readable detail
 * @returns {Promise<object|null>} the created audit document (or null on failure)
 */
export const logEvent = async ({ event, actor, targetId = null, ip = '', message = '' }) => {
  try {
    // Ensure the DB connection is ready; otherwise Mongoose will buffer and block.
    if (mongoose.connection.readyState !== 1) {
      // Not connected – try to connect quickly (fails fast if Mongo down).
      await mongoose.connect(config.mongo.uri, { dbName: config.mongo.dbName });
    }
    const doc = await Audit.create({
      event,
      actor: actor || 'anonymous',
      targetId,
      ip,
      message,
    });
    return doc;
  } catch (err) {
    logger.error({ err, event, actor, message }, 'AUDIT WRITE FAILED');
    return null;
  }
};

/**
 * Reads audit entries, newest first.
 *
 * @param {Object} [opts]
 * @param {number} [opts.limit] - max number of entries to return
 * @param {string} [opts.targetId] - filter to one target
 * @returns {Promise<object[]>}
 */
export const listEvents = async ({ limit = 100, targetId = null } = {}) => {
  // SYNTAX: an object literal conditionally built with a spread. If
  // `targetId` is null the filter is simply absent.
  const filter = targetId ? { targetId } : {};
  return Audit.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
};

export default { logEvent, listEvents };
