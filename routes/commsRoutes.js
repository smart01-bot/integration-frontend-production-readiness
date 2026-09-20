import express from 'express';
import { sendSms, sendEmail } from '../controllers/commsController.js';
import auth from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';

const router = express.Router();

router.use(auth());
router.use(requireRole(['admin']));

router.post('/sms', sendSms);
router.post('/email', sendEmail);

export default router;
