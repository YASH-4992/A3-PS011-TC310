import mongoose from 'mongoose';

/**
 * Audit – immutable log of every privileged action.
 *
 * FAIL CLOSED PRINCIPLE: every handler that changes state calls `logEvent()`.
 * Deleting an audit entry is *never* allowed – the schema has no delete hooks
 * and the API never exposes a DELETE endpoint.
 */
const AuditSchema = new mongoose.Schema(
  {
    event: {
      type: String,
      enum: [
        'login_success',
        'login_failure',
        'target_created',
        'target_deleted',
        'target_confirmed',
        'target_action_requested',
        'target_action_denied',
        'target_proof_verified',
        'target_out_of_scope',
        'scan_requested',
        'scan_started',
        'scan_completed',
        'scan_failed',
        // future events can be added; old entries stay valid.
      ],
      required: true,
    },
    actor: { type: String, required: true }, // username or 'anonymous'
    targetId: { type: mongoose.Schema.Types.ObjectId, ref: 'Target', default: null },
    ip: { type: String, default: '' },
    message: { type: String, default: '' },
  },
  { timestamps: true },
);

export default mongoose.model('Audit', AuditSchema);