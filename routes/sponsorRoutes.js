import express from 'express';
import { getSponsorPortal, uploadSponsorLogo } from '../controllers/sponsorController.js';
import { requireRole } from '../middleware/rbac.js';
import auth from '../middleware/auth.js';

const router = express.Router();

router.use(auth());
router.use(requireRole(['sponsor', 'admin']));

router.get('/portal', getSponsorPortal);
router.post('/logo/upload', uploadSponsorLogo);

export default router;
