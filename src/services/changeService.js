import Change from '../models/Change.js';
import Snapshot from '../models/Snapshot.js';
import logger from '../utils/logger.js';
import { diffEngine } from './diffEngine.js';

export const diffAndRecord = async ({ target, snapshot }) => {
  const previousSnapshot = await Snapshot.findOne({
    target: target._id,
    status: 'completed',
    _id: { $ne: snapshot._id },
  }).sort({ createdAt: -1 }).lean();

  const changes = diffEngine(previousSnapshot, snapshot);
  if (changes.length === 0) {
    return [];
  }

  const records = await Change.insertMany(changes.map((change) => ({
    target: target._id,
    snapshotId: snapshot._id,
    previousSnapshotId: previousSnapshot._id,
    type: change.type,
    severity: change.severity,
    details: change.details,
    port: change.port,
  })));

  for (const change of changes) {
    logger.info(`ALERT [${change.severity}] ${change.type}: ${change.details}`);
  }

  return records;
};

export default { diffAndRecord };
