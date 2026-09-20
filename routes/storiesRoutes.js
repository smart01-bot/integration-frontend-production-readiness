import { Router } from 'express';
import auth from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { clampPagination, readLimiter, mutationLimiter } from '../middleware/apiHygiene.js';
import { getStories, submitStory, approveStory } from '../controllers/whyIParticipateController.js';

const router = Router();

router.get('/', readLimiter, clampPagination, getStories);
router.post('/', mutationLimiter, auth(), submitStory);
router.patch('/:storyId/approve', auth(), requireRole(['admin']), approveStory);

export default router;
