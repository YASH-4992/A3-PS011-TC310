import express from 'express';
const router = express.Router();

/**
 * GET /api/targets – placeholder protected endpoint.
 * Returns an empty array; real implementation will list DB targets.
 */
router.get('/targets', (req, res) => {
  res.json({ targets: [] });
});

export default router;
