import { Router } from 'express';
import auth from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import {
  getBib,
  getMyBib,
  generateBib,
  claimBib,
  batchGenerateBibs
} from '../controllers/bibController.js';

const router = Router();

// Participant endpoints
router.get('/me', auth(), getMyBib);
router.post('/generate', auth(), generateBib);
router.post('/claim', auth(), claimBib);
router.post('/claim/:bibNumber', auth(), claimBib);

// Admin batch endpoints
router.post('/batch', auth(), requireRole(['admin']), batchGenerateBibs);

// Public lookup by ID, bib_number, or share_slug
router.get('/:identifier', getBib);

export default router;
