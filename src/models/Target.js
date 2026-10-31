import mongoose from 'mongoose';

/**
 * Target – a host we are allowed to scan.
 *
 * WHY THIS SCHEMA
 * ----------------
 * All authorization state lives on the Target model (not in env). The fields
 * are documented in the project’s design docs; each field is required for the
 * later stages (proof verification, scan lock, scope enforcement).
 *
 * ZOD VALIDATION (see `src/config/index.js`) ensures no target can be created
 * with a missing or malformed IP/hostname. All strings are trimmed before
 * storage (Mongoose `trim: true`).
 */
const TargetSchema = new mongoose.Schema(
  {
    hostname: { type: String, required: true, trim: true },
    ip: { type: String, required: true, trim: true },
    label: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'proof_verified', 'disabled'],
      default: 'pending',
    },
    confirmedBy: { type: String, default: null },
    confirmedAt: { type: Date, default: null },
    proofNonce: { type: String, default: null },
    proofVerifiedAt: { type: Date, default: null },
    maxTier: { type: Number, enum: [1, 2, 3], default: 2 }, // tier control
  },
  { timestamps: true },
);

export default mongoose.model('Target', TargetSchema);
