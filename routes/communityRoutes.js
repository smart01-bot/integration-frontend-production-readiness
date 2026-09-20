import { Router } from 'express';
import auth from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { clampPagination, readLimiter, writeLimiter } from '../middleware/apiHygiene.js';
import {
  getPosts,
  createPost,
  reactToPost,
  addComment,
  getComments,
  reportPost,
  getPostReports,
  moderatePost,
  deletePost,
  deleteComment
} from '../controllers/communityController.js';

const router = Router();

// Public read (memory/archive modes keep these readable) — rate-limited + clamped
router.get('/posts', readLimiter, clampPagination, getPosts);
router.get('/posts/:postId/comments', readLimiter, getComments);

// Social writes — lifecycle-gated inside the controller (§17), rate-limited (§15)
router.post('/posts', writeLimiter, auth(), createPost);
router.post('/posts/:postId/react', writeLimiter, auth(), reactToPost);
router.post('/posts/:postId/comments', writeLimiter, auth(), addComment);

// §15 Own-content delete (author or staff)
router.delete('/posts/:postId', auth(), deletePost);
router.delete('/comments/:commentId', auth(), deleteComment);

// §15 — every signed-in participant can report
router.post('/posts/:postId/report', writeLimiter, auth(), reportPost);

// §15 — moderation queue and decisions, admin only
router.get('/reports', auth(), requireRole(['admin']), getPostReports);
router.patch('/posts/:postId/moderate', auth(), requireRole(['admin']), moderatePost);

export default router;
