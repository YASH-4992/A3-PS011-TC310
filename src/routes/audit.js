import express from 'express';
import { z } from 'zod';
import { listEvents } from '../services/auditService.js';

const router = express.Router();

/**
 * Zod schema for the audit query string.
 *
 * SYNTAX: `z.coerce.number()` converts the string `"50"` from the query
 * string into the number 50 before validating it.
 */
const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  targetId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
});

/**
 * GET /api/audit – read the audit trail.
 *
 * READ-ONLY BY DESIGN. There is intentionally NO `POST`, `PUT`, `PATCH` or
 * `DELETE` handler on this router. The audit trail is append-only: entries
 * are written by `auditService.logEvent()` and can only ever be read back.
 * If you need to edit history, you need direct database access – which is a
 * different (and louder) class of action.
 */
router.get('/', async (req, res) => {
  const parsed = AuditQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return res.status(400).json({ error: `Invalid input: ${issues}` });
  }

  const { limit, targetId } = parsed.data;
  const events = await listEvents({ limit, targetId: targetId || null });
  res.json(events);
});

export default router;
