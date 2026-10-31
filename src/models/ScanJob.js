import mongoose from 'mongoose';

/**
 * ScanJob – tracks the lifecycle of an asynchronous scan.
 *
 * A ScanJob is created when a client requests a scan (POST /api/scan/:id).
 * It starts with status 'pending', moves to 'running', then 'completed' or
 * 'failed'. The job stores the requesting user, timestamps and a link to
 * the resulting Snapshot (if any).
 */
const ScanJobSchema = new mongoose.Schema(
  {
    scanId: { type: String, required: true, unique: true },
    target: { type: mongoose.Schema.Types.ObjectId, ref: 'Target', required: true },
    status: { type: String, enum: ['pending', 'running', 'completed', 'failed'], required: true },
    requestedBy: { type: String, required: true },
    startedAt: { type: Date },
    completedAt: { type: Date },
    durationMs: { type: Number },
    snapshotId: { type: mongoose.Schema.Types.ObjectId, ref: 'Snapshot' },
    error: { type: String },
  },
  { timestamps: true },
);

export default mongoose.model('ScanJob', ScanJobSchema);