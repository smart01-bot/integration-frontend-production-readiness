import express from 'express';
import { getPartnerClearances, updateSafetyClearance } from '../controllers/partnerController.js';
import { requireRole } from '../middleware/rbac.js';
import auth from '../middleware/auth.js';

const router = express.Router();

router.use(auth());
router.use(requireRole(['partner', 'admin']));

router.get('/clearances', getPartnerClearances);
router.post('/clearances/update', updateSafetyClearance);

export default router;
