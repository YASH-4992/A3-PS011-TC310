import express from 'express';
const router = express.Router();

/**
 * GET /dashboard – placeholder protected UI endpoint.
 * Authenticated users see this; unauthenticated are redirected to /login by authMiddleware.
 */
router.get('/dashboard', (req, res) => {
  res.send('Dashboard placeholder – replace with real UI later');
});

export default router;