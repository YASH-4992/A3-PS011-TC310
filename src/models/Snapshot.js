import mongoose from 'mongoose';

/**
 * Snapshot – the recorded result of one scan run.
 *
 * Each scan writes exactly ONE snapshot. Snapshots are NEVER updated; a new
 * scan creates a new document (immutability = clean diffs, clean audit).
 *
 * Port entry sub-document:
 *   - port: number
 *   - protocol: 'tcp' | 'tls'
 *   - banner: string (raw, may be empty)
 *   - tls: { subject, issuer, notBefore, notAfter, fingerprint } | null
 *   - http: { status, server, title } | null
 */
const PortEntrySchema = new mongoose.Schema({
  port: { type: Number, required: true },
  protocol: { type: String, enum: ['tcp', 'tls'], required: true },
  banner: { type: String, default: '' },
  tls: {
    subject: { type: String, default: '' },
    issuer: { type: String, default: '' },
    notBefore: { type: Date, default: null },
    notAfter: { type: Date, default: null },
    fingerprint: { type: String, default: '' },
  },
  http: {
    status: { type: Number, default: null },
    server: { type: String, default: '' },
    title: { type: String, default: '' },
  },
}, { _id: false });

const SnapshotSchema = new mongoose.Schema(
  {
    target: { type: mongoose.Schema.Types.ObjectId, ref: 'Target', required: true },
    scanId: { type: String, required: true, index: true }, // for API lookups
    ports: [PortEntrySchema],
    status: { type: String, enum: ['running', 'completed', 'failed', 'partial'], required: true },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    durationMs: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export default mongoose.model('Snapshot', SnapshotSchema);