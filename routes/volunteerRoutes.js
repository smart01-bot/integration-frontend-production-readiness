import express from 'express';
import { getMyVolunteerShift, acknowledgeBriefing } from '../controllers/volunteerController.js';
import { checkInTicket } from '../controllers/ticketController.js';
import { requireRole } from '../middleware/rbac.js';
import auth from '../middleware/auth.js';

const router = express.Router();

router.use(auth());
router.use(requireRole(['volunteer', 'admin']));

router.get('/shift', getMyVolunteerShift);
router.post('/briefing/acknowledge', acknowledgeBriefing);
router.post('/checkin-ticket', checkInTicket);

export default router;
