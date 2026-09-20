import { Router } from 'express';
import auth from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import {
  getMyConsent,
  updateMyConsent,
  getAnonymizedResearchSummary
} from '../controllers/researchController.js';

const router = Router();

// Participant self-service research consent
router.get('/consent', auth(), getMyConsent);
router.put('/consent', auth(), updateMyConsent);

// Anonymized aggregation for research / M&E (§18)
router.get('/summary', auth(), requireRole(['admin']), getAnonymizedResearchSummary);

export default router;
