import express from 'express';
import auth from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { clampPagination, readLimiter } from '../middleware/apiHygiene.js';
import {
  getTriathlonOverview,
  getLiveActivity,
  getCourseMap,
  getCommunityImpact,
  updateLifecycleMode
} from '../controllers/triathlonController.js';
import {
  createWaypoint,
  updateWaypoint,
  deleteWaypoint,
  createCategory,
  updateCategory
} from '../controllers/eventContentController.js';

const router = express.Router();

router.get('/overview', readLimiter, getTriathlonOverview);
router.get('/live-activity', readLimiter, getLiveActivity);
router.get('/map', readLimiter, getCourseMap);
router.get('/impact', readLimiter, getCommunityImpact);
router.patch('/lifecycle', auth(), requireRole(['admin']), updateLifecycleMode);

// §10 Dar Map waypoints — staff-maintained, public-read via RLS (gap 13)
router.post('/waypoints', auth(), requireRole(['admin']), createWaypoint);
router.patch('/waypoints/:waypointId', auth(), requireRole(['admin']), updateWaypoint);
router.delete('/waypoints/:waypointId', auth(), requireRole(['admin']), deleteWaypoint);

// §2/§12 race categories + wave start times (gap 12)
router.post('/categories', auth(), requireRole(['admin']), createCategory);
router.patch('/categories/:categoryId', auth(), requireRole(['admin']), updateCategory);

export default router;
