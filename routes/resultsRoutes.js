import { Router } from 'express';
import auth from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { clampPagination, readLimiter } from '../middleware/apiHygiene.js';
import {
  getResults,
  getLeaderboard,
  getMyResult,
  ingestResults,
  ingestResultsCsv,
  updateResult,
  deleteResult
} from '../controllers/resultsController.js';

const router = Router();

// Public / participant reads
router.get('/', readLimiter, clampPagination, getResults);
router.get('/leaderboard', readLimiter, getLeaderboard);
router.get('/me', auth(), getMyResult);

// Admin results ingestion & management (§8, §14)
router.post('/', auth(), requireRole(['admin']), ingestResults);
router.post('/batch', auth(), requireRole(['admin']), ingestResults);
router.post('/csv', auth(), requireRole(['admin']), ingestResultsCsv);
router.patch('/:id', auth(), requireRole(['admin']), updateResult);
router.delete('/:id', auth(), requireRole(['admin']), deleteResult);

export default router;
