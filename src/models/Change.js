import mongoose from 'mongoose';

/**
 * Change – a single difference between two snapshots.
 *
 * WHY EVERY CHANGE REFERENCES BOTH SNAPSHOTS
 * -------------------------------------------
 * A change is only meaningful as a *difference*. By storing `snapshotId` and
 * `previousSnapshotId` on every change, an auditor can always reconstruct
 * exactly which two observations produced it, and the diff engine stays a
 * PURE function (see `src/services/diffEngine.js`).
 */
const ChangeSchema = new mongoose.Schema(
  {
    target: { type: mongoose.Schema.Types.ObjectId, ref: 'Target', required: true, index: true },
    snapshotId: { type: mongoose.Schema.Types.ObjectId, ref: 'Snapshot', required: true },
    previousSnapshotId: { type: mongoose.Schema.Types.ObjectId, ref: 'Snapshot', required: true },
    type: {
      type: String,
      enum: [
        'port_opened',
        'port_closed',
        'banner_changed',
        'http_changed',
        'cert_changed',
        'cert_expiring',
        'host_added',
        'host_removed',
      ],
      required: true,
    },
    severity: { type: String, enum: ['info', 'medium', 'high'], default: 'info' },
    details: { type: String, default: '' },
    port: { type: Number, default: null },
  },
  { timestamps: true },
);

export default mongoose.model('Change', ChangeSchema);