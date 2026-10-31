import express from 'express';
import Target from '../models/Target.js';
import Snapshot from '../models/Snapshot.js';
import ScanJob from '../models/ScanJob.js';
import config from '../config/index.js';
import { logEvent } from '../services/auditService.js';
import { runScan } from '../services/scanner.js';
import { diffAndRecord } from '../services/changeService.js';
import { acquireScanLock, releaseScanLock } from '../services/scanLock.js';

const router = express.Router();
const targetIdSchema = /^[a-f\d]{24}$/i;
const uiRedirect = (res, message) => res.redirect(`/dashboard/inventory?message=${encodeURIComponent(message)}`);
const sendError = (req, res, status, message) => (
  req.body?._ui === '1' ? uiRedirect(res, message) : res.status(status).json({ error: message })
);

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
  if (!targetIdSchema.test(req.params.id)) {
    return sendError(req, res, 400, 'Invalid target id');
  }
  const target = await Target.findById(req.params.id);
  if (!target) {
    return sendError(req, res, 404, 'Target not found');
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
    return sendError(req, res, 400, `Target must be ${requiredStatus} before scanning (current: ${target.status})`);
  }

  // Every scan gets an id so the client can poll for it.
  const scanId = `scan_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  // AUDIT BEFORE A JOB STARTS. A failed audit write refuses the scan.
  const auditDoc = await logEvent({
    event: 'scan_started',
    actor: req.session?.user || 'anonymous',
    targetId: target._id,
    ip: target.ip,
    message: `Scan ${scanId} started for ${target.hostname} (${target.ip})`,
  });
  if (!auditDoc) {
    return sendError(req, res, 503, 'Audit trail unavailable - scan refused (fail closed)');
  }

  // Record the job as pending so the client can already poll it.
  await ScanJob.create({
    scanId,
    target: target._id,
    status: 'pending',
    requestedBy: req.session?.user || 'anonymous',
  });

  // Fire and forget: the scan continues in the background.
  runScanAsync(target, scanId, req.session?.user || 'anonymous', req.app.locals.scanOptions);

  if (req.body?._ui === '1') {
    return uiRedirect(res, `Scan ${scanId} started. Refresh Inventory to view the result.`);
  }
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
 * @param {string} requestedBy
 */
async function runScanAsync(target, scanId, requestedBy, scanOptions) {
  const targetId = target._id.toString();
  const locked = acquireScanLock(targetId);
  let snapshot;

  try {
    if (!locked) {
      throw new Error('Target is already being scanned');
    }

    await ScanJob.findOneAndUpdate({ scanId }, { status: 'running', startedAt: new Date() });

    // runScan does the scope re-check, the DNS resolution and the probes.
    const snapshotData = await runScan(target, {
      ...scanOptions,
      scanId,
    });

    // Save the snapshot. Snapshots are never updated after this point.
    snapshot = await Snapshot.create(snapshotData);

    // Failed scans never reach the diff step. A diff write failure also
    // prevents this result from being treated as a successful snapshot.
    await diffAndRecord({ target, snapshot });

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

  } catch (err) {
    if (snapshot) {
      await Snapshot.updateOne({ _id: snapshot._id }, { status: 'failed' });
    }
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
  if (!/^scan_\d+_[a-z0-9]+$/i.test(req.params.scanId)) {
    return res.status(400).json({ error: 'Invalid scan id' });
  }
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
    requestedBy: job.requestedBy,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    durationMs: job.durationMs,
    error: job.error,
    snapshot,
  });
});

export default router;
