import express from 'express';
import Target from '../models/Target.js';
import Snapshot from '../models/Snapshot.js';
import ScanJob from '../models/ScanJob.js';
import config from '../config/index.js';
import { logEvent } from '../services/auditService.js';
import { runScan } from '../services/scanner.js';
import { acquireScanLock, releaseScanLock } from '../services/scanLock.js';

const router = express.Router();

/**
 * POST /api/scan/:id – start a scan for the target with that id.
 *
 * Security rules enforced here:
 *  - the target must be confirmed (and proof-verified when required),
 *  - the scope is re-checked inside the scanner at scan time,
 *  - the audit trail is written BEFORE any network I/O; if the audit write
 *    fails we answer 503 and scan nothing (fail closed),
 *  - a per-target lock stops two scans of the same host at once.
 *
 * We answer 202 immediately and let the scan run in the background; the
 * client polls GET /api/scans/:scanId for the result.
 */
router.post('/scan/:id', async (req, res) => {
  const target = await Target.findById(req.params.id);
  if (!target) {
    return res.status(404).json({ error: 'Target not found' });
  }

  // Authorization gate. A target that was never confirmed (or whose proof
  // was never verified) is not scan-eligible.
  const requiredStatus = config.proof.requiredBeforeScan ? 'proof_verified' : 'confirmed';
  if (target.status !== requiredStatus) {
    await logEvent({
      event: 'scan_failed',
      actor: req.session?.user || 'anonymous',
      targetId: target._id,
      ip: target.ip,
      message: `Scan DENIED for ${target.hostname}: status is ${target.status}, needs ${requiredStatus}`,
    });
    return res.status(400).json({
      error: `Target must be ${requiredStatus} before scanning (current: ${target.status})`,
    });
  }

  // Every scan gets an id so the client can poll for it.
  const scanId = `scan_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  // AUDIT BEFORE WE DO ANYTHING ELSE. If we cannot record the request we do
  // not run the scan. `logEvent` returns null when the write failed.
  const auditDoc = await logEvent({
    event: 'scan_requested',
    actor: req.session?.user || 'anonymous',
    targetId: target._id,
    ip: target.ip,
    message: `Scan ${scanId} requested for ${target.hostname} (${target.ip})`,
  });
  if (!auditDoc) {
    return res.status(503).json({ error: 'Audit trail unavailable - scan refused (fail closed)' });
  }

  // Record the job as pending so the client can already poll it.
  const tier = req.body?.tier || target.maxTier || 2;
  await ScanJob.create({
    scanId,
    target: target._id,
    status: 'pending',
    requestedBy: req.session?.user || 'anonymous',
    tier,
  });

  // Fire and forget: the scan continues in the background.
  runScanAsync(target, scanId, tier, req.session?.user || 'anonymous');

  res.status(202).json({
    scanId,
    status: 'pending',
    message: 'Scan started. Poll GET /api/scans/:scanId for status.',
  });
});

/**
 * Runs the scan in the background and records the outcome.
 *
 * @param {Object} target - Mongoose Target document
 * @param {string} scanId
 * @param {number} tier
 * @param {string} requestedBy
 */
async function runScanAsync(target, scanId, tier, requestedBy) {
  const targetId = target._id.toString();
  const locked = acquireScanLock(targetId);

  try {
    if (!locked) {
      throw new Error('Target is already being scanned');
    }

    await ScanJob.findOneAndUpdate({ scanId }, { status: 'running', startedAt: new Date() });

    // runScan does the scope re-check, the DNS resolution and the probes.
    const snapshotData = await runScan(target, { tier, scanId, requestedBy });

    // Save the snapshot. Snapshots are never updated after this point.
    const snapshot = await Snapshot.create(snapshotData);

    await ScanJob.findOneAndUpdate({ scanId }, {
      status: 'completed',
      completedAt: new Date(),
      durationMs: snapshot.durationMs,
      snapshotId: snapshot._id,
    });

    await logEvent({
      event: 'scan_completed',
      actor: requestedBy,
      targetId: target._id,
      ip: target.ip,
      message: `Scan ${scanId} completed with ${snapshotData.ports.length} open ports`,
    });

    // Diff against the previous snapshot and store the changes.
    // WHY HERE: a FAILED scan never reaches this point, so a failed scan is
    // never diffed - otherwise a broken scan would look like "ports closed".
    try {
      const { diffAndRecord } = await import('../services/changeService.js');
      await diffAndRecord({ target, snapshot, requestedBy });
    } catch (err) {
      // A diffing failure must not turn a good scan into a failed one.
      console.error('Diff failed:', err.message);
    }
  } catch (err) {
    await ScanJob.findOneAndUpdate({ scanId }, {
      status: 'failed',
      completedAt: new Date(),
      error: err.message,
    });

    await logEvent({
      event: 'scan_failed',
      actor: requestedBy,
      targetId: target._id,
      ip: target.ip,
      message: `Scan ${scanId} failed: ${err.message}`,
    });
  } finally {
    // Always release the lock, even when the scan threw.
    if (locked) {
      releaseScanLock(targetId);
    }
  }
}

/**
 * GET /api/scans/:scanId – status (and result) of one scan.
 */
router.get('/scans/:scanId', async (req, res) => {
  const job = await ScanJob.findOne({ scanId: req.params.scanId }).lean();
  if (!job) {
    return res.status(404).json({ error: 'Scan not found' });
  }

  const snapshot = job.snapshotId
    ? await Snapshot.findById(job.snapshotId).lean()
    : null;

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
