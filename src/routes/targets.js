import { z } from 'zod';
import express from 'express';
import Target from '../models/Target.js';
import Snapshot from '../models/Snapshot.js';
import config from '../config/index.js';
import { isIpInScope, isValidIp } from '../utils/ip.js';
import { logEvent } from '../services/auditService.js';
import { verifyProof } from '../services/proofService.js';
import crypto from 'crypto';

const router = express.Router();

/**
 * Zod schemas for input validation.
 *
 * SYNTAX: `z.object({...})` creates a schema that validates an object.
 * `.safeParse()` returns `{success, data, error}` instead of throwing.
 * This is fail-closed: we reject on the first validation error.
 */

// Strict hostname rule: only letters, digits, dots and hyphens; it must not
// start or end with a hyphen. This blocks spaces, slashes, '@' and other
// characters that have no business being in a hostname field.
const hostnameSchema = z.string().min(1).max(255).regex(/^(?!-)[A-Za-z0-9.-]+(?<!-)$/);

const CreateTargetSchema = z.object({
  hostname: hostnameSchema,
  ip: z.string().refine((val) => isValidIp(val), { message: 'Invalid IP address' }), // IPv4 or IPv6
  label: z.string().max(120).optional(),
  maxTier: z.number().int().min(1).max(3).optional(),
});

// POST /api/targets – create a target.
router.post('/', async (req, res) => {
  const parsed = CreateTargetSchema.safeParse(req.body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return res.status(400).json({ error: `Invalid input: ${issues}` });
  }

  const { hostname, ip, label, maxTier } = parsed.data;

  // FAIL CLOSED: scope gate.
  if (!isIpInScope(ip, config.scopeCidrs)) {
    await logEvent({
      event: 'target_out_of_scope',
      actor: req.session?.user || 'anonymous',
      targetId: null,
      ip,
      message: `CREATE DENIED: ${ip} is outside SCOPE_CIDRS`,
    });
    return res.status(400).json({ error: 'Target IP is outside the authorized scope' });
  }

  // Check duplicate hostname
  const existing = await Target.findOne({ hostname });
  if (existing) {
    return res.status(409).json({ error: 'Hostname already registered' });
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  const target = await Target.create({
    hostname,
    ip,
    label: label || '',
    status: 'pending',
    proofNonce: nonce,
    maxTier: maxTier ?? 2,
  });

  await logEvent({
    event: 'target_created',
    actor: req.session?.user || 'anonymous',
    targetId: target._id,
    ip,
    message: `Created target ${hostname} (${ip})`,
  });

  res.status(201).json({
    id: target._id,
    hostname: target.hostname,
    ip: target.ip,
    label: target.label,
    status: target.status,
    proofNonce: target.proofNonce,
    maxTier: target.maxTier,
    createdAt: target.createdAt,
    updatedAt: target.updatedAt,
  });
});

/**
 * GET /api/targets – list targets.
 *
 * Returns confirmed and proof_verified targets (hidden pending ones by default).
 * Query `?all=true` shows all statuses (admin only via UI).
 */
router.get('/', async (req, res) => {
  const showAll = req.query.all === 'true';
  const filter = showAll ? {} : { status: { $in: ['confirmed', 'proof_verified'] } };
  const targets = await Target.find(filter).sort({ createdAt: -1 }).lean();
  res.json(targets);
});

/**
 * GET /api/targets/:id – get one target (with last snapshot summary).
 */
router.get('/:id', async (req, res) => {
  const target = await Target.findById(req.params.id).lean();
  if (!target) {
    return res.status(404).json({ error: 'Target not found' });
  }
  // Include latest snapshot count for UI badge
  const latestSnap = await Snapshot.findOne({ target: target._id })
    .sort({ createdAt: -1 })
    .select('ports status createdAt')
    .lean();
  target.latestSnapshot = latestSnap;
  res.json(target);
});

/**
 * DELETE /api/targets/:id – delete a target.
 *
 * Only allowed if target has NO snapshots (never scanned).
 */
router.delete('/:id', async (req, res) => {
  const target = await Target.findById(req.params.id);
  if (!target) {
    return res.status(404).json({ error: 'Target not found' });
  }

  const snapCount = await Snapshot.countDocuments({ target: target._id });
  if (snapCount > 0) {
    return res.status(409).json({ error: 'Cannot delete a target that has been scanned' });
  }

  await Target.findByIdAndDelete(req.params.id);

  await logEvent({
    event: 'target_deleted',
    actor: req.session?.user || 'anonymous',
    targetId: target._id,
    ip: target.ip,
    message: `Deleted target ${target.hostname} (${target.ip})`,
  });

  res.status(204).end();
});

/**
 * POST /api/targets/:id/confirm – mark target as confirmed.
 *
 * Requires the target to be in 'pending' status. Records who/when.
 */
router.post('/:id/confirm', async (req, res) => {
  const target = await Target.findById(req.params.id);
  if (!target) {
    return res.status(404).json({ error: 'Target not found' });
  }
  if (target.status !== 'pending') {
    return res.status(400).json({ error: 'Only pending targets can be confirmed' });
  }

  target.status = 'confirmed';
  target.confirmedBy = req.session?.user || 'anonymous';
  target.confirmedAt = new Date();
  await target.save();

  await logEvent({
    event: 'target_confirmed',
    actor: req.session?.user || 'anonymous',
    targetId: target._id,
    ip: target.ip,
    message: `Confirmed target ${target.hostname} (${target.ip})`,
  });

  res.json({
    id: target._id,
    status: target.status,
    confirmedBy: target.confirmedBy,
    confirmedAt: target.confirmedAt,
  });
});

/**
 * POST /api/targets/:id/verify-proof – fetch proof file and compare nonce.
 *
 * Respects REQUIRE_PROOF_BEFORE_SCAN flag.
 * On success: sets proofVerifiedAt, clears proofNonce (optional), status -> proof_verified.
 * On failure: returns 400 with reason.
 */
router.post('/:id/verify-proof', async (req, res) => {
  const target = await Target.findById(req.params.id);
  if (!target) {
    return res.status(404).json({ error: 'Target not found' });
  }
  if (!target.proofNonce) {
    return res.status(400).json({ error: 'No proof nonce available for this target' });
  }
  if (target.status !== 'confirmed' && target.status !== 'proof_verified') {
    return res.status(400).json({ error: 'Target must be confirmed before proof verification' });
  }

  const ok = await verifyProof({
    ip: target.ip,
    nonce: target.proofNonce,
    timeoutMs: config.proof.httpTimeoutMs,
  });

  if (!ok) {
    await logEvent({
      event: 'target_proof_verified',
      actor: req.session?.user || 'anonymous',
      targetId: target._id,
      ip: target.ip,
      message: `Proof verification FAILED for ${target.hostname} (${target.ip})`,
    });
    return res.status(400).json({ error: 'Proof verification failed (file missing or nonce mismatch)' });
  }

  target.status = 'proof_verified';
  target.proofVerifiedAt = new Date();
  target.proofNonce = null; // consumed
  await target.save();

  await logEvent({
    event: 'target_proof_verified',
    actor: req.session?.user || 'anonymous',
    targetId: target._id,
    ip: target.ip,
    message: `Proof VERIFIED for ${target.hostname} (${target.ip})`,
  });

  res.json({
    id: target._id,
    status: target.status,
    proofVerifiedAt: target.proofVerifiedAt,
  });
});

export default router;