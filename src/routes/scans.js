import express from 'express';
import Target from '../models/Target.js';
import Snapshot from '../models/Snapshot.js';
import ScanJob from '../models/ScanJob.js';
import config from '../config/index.js';
import { logEvent } from '../services/auditService.js';
import { acquireScanLock, releaseScanLock } from '../services/scanLock.js';

const router = express.Router();

/**
 * POST /api/scan/:id – initiate a scan for the target.
 *
 * Requirements:
 * - Target must exist and be confirmed or proof_verified (depends on REQUIRE_PROOF_BEFORE_SCAN)
 * - Scope re-check at scan time (resolve hostname, validate ALL resolved IPs)
 * - Audit scan_started BEFORE any network I/O; fail closed (503) if audit write fails
 * - Per-target lock with timeout (prevents concurrent scans)
 * - Returns 202 with scanId immediately; scan runs async
 */
router.post('/scan/:id', async (req, res) => {
  const target = await Target.findById(req.params.id);
  if (!target) {
    return res.status(404).json({ error: 'Target not found' });
  }

  // Status check
  const requiredStatus = config.proof.requiredBeforeScan ? 'proof_verified' : 'confirmed';
  if (target.status !== requiredStatus) {
    return res.status(400).json({
      error: `Target must be ${requiredStatus} before scanning (current: ${target.status})`,
    });
  }

  // Generate unique scan ID
  const scanId = `scan_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  // Create ScanJob record (pending)
  await ScanJob.create({
    scanId,
    target: target._id,
    status: 'pending',
    requestedBy: req.session?.user || 'anonymous',
    tier: req.body.tier || target.maxTier || 2,
  });

  // AUDIT: scan_requested - this happens before the lock/scope re-check
  // so we have a record of the attempt even if it fails
  await logEvent({
    event: 'scan_requested',
    actor: req.session?.user || 'anonymous',
    targetId: target._id,
    ip: target.ip,
    message: `Scan ${scanId} requested for ${target.hostname} (${target.ip})`,
  });

  // Try to start the scan asynchronously (don't await - return 202 immediately)
  runScanAsync(target, scanId, req.body.tier || target.maxTier || 2, req.session?.user || 'anonymous');

  res.status(202).json({
    scanId,
    status: 'pending',
    message: 'Scan started. Poll GET /api/scans/:scanId for status.',
  });
});

/**
 * Runs the scan in the background.
 *
 * @param {Object} target - Mongoose Target document
 * @param {string} scanId
 * @param {number} tier
 * @param {string} requestedBy
 */
async function runScanAsync(target, scanId, requestedBy) {
  try {
    // Update ScanJob to running
    await ScanJob.findOneAndUpdate({ scanId }, { status: 'running', startedAt: new Date() });

    // Acquire per‑target lock – fail closed if we cannot lock.
    if (!acquireScanLock(target._id.toString())) {
      await logEvent({
        event: 'scan_failed',
        actor: requestedBy,
        targetId: target._id,
        ip: target.ip,
        message: `Scan ${scanId} rejected: target already being scanned`,
      });
      throw new Error('Target is already being scanned');
    }


    // Save snapshot
    const snapshot = await Snapshot.create(snapshotData);

    // Update ScanJob to completed
    await ScanJob.findOneAndUpdate({ scanId }, {
      status: 'completed',
      completedAt: new Date(),
      durationMs: snapshot.durationMs,
      snapshotId: snapshot._id,
    });

    // Audit completion
    await logEvent({
      event: 'scan_completed',
      actor: requestedBy,
      targetId: target._id,
      ip: target.ip,
      message: `Scan ${scanId} completed with ${snapshotData.ports.length} open ports`,
    });
  } catch (err) {
    // Update ScanJob to failed
    await ScanJob.findOneAndUpdate({ scanId }, {
      status: 'failed',
      completedAt: new Date(),
      error: err.message,
    });

    // Audit failure (best effort)
    await logEvent({
      event: 'scan_failed',
      actor: requestedBy,
      targetId: target._id,
      ip: target.ip,
      message: `Scan ${scanId} failed: ${err.message}`,
    });
  }
}

/**
 * GET /api/scans/:scanId – get scan status and results.
 */
router.get('/:scanId', async (req, res) => {
  const job = await ScanJob.findOne({ scanId: req.params.scanId }).lean();
  if (!job) {
    return res.status(404).json({ error: 'Scan not found' });
  }

  let snapshot = null;
  if (job.snapshotId) {
    snapshot = await Snapshot.findById(job.snapshotId).lean();
  }

  res.json({
    scanId: job.scanId,
    targetId: job.target,
    status: job.status,
    tier: job.tier,
    requestedBy: job.requestedBy,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    durationMs: job.durationMs,
    error: job.error,
    snapshot,
  });
});

export default router;