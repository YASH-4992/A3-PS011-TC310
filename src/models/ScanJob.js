import mongoose from 'mongoose';

/**
 * ScanJob – tracks an ongoing scan request.
 *
 * The API returns a `scanId` immediately (202 Accepted). The client polls
 * `GET /api/scans/:scanId` until the status is `completed` or `failed`.
 * This keeps the request/response cycle short and avoids HTTP timeouts.
 */
const ScanJobSchema = new mongoose.Schema(
  {
    target: { type: mongoose.Schema.Types.ObjectId, ref: 'Target', required: true, index: true },
    scanId: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: ['pending', 'running', 'completed', 'failed'], default: 'pending' },
    requestedBy: { type: String, required: true },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    error: { type: String, default: '' },
  },
  { timestamps: true },
);

export default mongoose.model('ScanJob', ScanJobSchema);