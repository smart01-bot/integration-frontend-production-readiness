import { Router } from 'express';
import auth from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { clampPagination, readLimiter, mutationLimiter, writeLimiter } from '../middleware/apiHygiene.js';
import {
  getChallenges,
  joinChallenge,
  completeChallenge,
  getChallengeLeaderboard,
  createChallenge,
  updateChallenge,
  deleteChallenge,
  endChallenge
} from '../controllers/challengeController.js';

const router = Router();

// Participant / Public endpoints
router.get('/', readLimiter, clampPagination, getChallenges);
router.post('/:challengeId/join', mutationLimiter, auth(), joinChallenge);
router.patch('/:challengeId/complete', mutationLimiter, auth(), completeChallenge);
router.get('/:challengeId/leaderboard', readLimiter, getChallengeLeaderboard);

// Admin Challenge CRUD endpoints (§9)
router.post('/', auth(), requireRole(['admin']), createChallenge);
router.put('/:challengeId', auth(), requireRole(['admin']), updateChallenge);
router.delete('/:challengeId', auth(), requireRole(['admin']), deleteChallenge);
router.patch('/:challengeId/end', auth(), requireRole(['admin']), endChallenge);

export default router;
