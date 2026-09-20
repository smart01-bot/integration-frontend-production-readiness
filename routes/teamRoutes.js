import { Router } from 'express';
import auth from '../middleware/auth.js';
import { clampPagination, readLimiter, mutationLimiter, writeLimiter } from '../middleware/apiHygiene.js';
import {
  getTeams,
  getTeamDetail,
  createTeam,
  joinTeam,
  leaveTeam,
  updateTeam,
  getTeamDiscussions,
  postTeamDiscussion
} from '../controllers/teamController.js';

const router = Router();

router.get('/', readLimiter, clampPagination, getTeams);
router.get('/:teamId', getTeamDetail);
router.post('/', mutationLimiter, auth(), createTeam);
router.patch('/:teamId', auth(), updateTeam);
router.post('/:teamId/join', mutationLimiter, auth(), joinTeam);
router.delete('/:teamId/leave', auth(), leaveTeam);

// §15 Team discussions / event chat
router.get('/:teamId/discussions', auth(), getTeamDiscussions);
router.post('/:teamId/discussions', auth(), postTeamDiscussion);

export default router;
