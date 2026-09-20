import { Router } from 'express';
import auth from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import {
  getMyConsent,
  updateMyConsent,
  withdrawMyConsent,
  getConsentSummary
} from '../controllers/consentController.js';

const router = Router();

// §18 — consent is self-service and explicit.
router.get('/', auth(), getMyConsent);
router.put('/', auth(), updateMyConsent);
router.delete('/', auth(), withdrawMyConsent);

// Aggregated totals only; no individual choices leave the building.
router.get('/summary', auth(), requireRole(['admin']), getConsentSummary);

export default router;
