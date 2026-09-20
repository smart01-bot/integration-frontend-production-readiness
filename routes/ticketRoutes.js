import express from 'express';
import { getMyTickets, getTicketByQrToken, checkInTicket } from '../controllers/ticketController.js';
import { requireRole } from '../middleware/rbac.js';
import auth from '../middleware/auth.js';

const router = express.Router();

router.use(auth());

router.get('/', getMyTickets);
router.get('/qr/:qr_token', getTicketByQrToken);
router.post('/checkin', requireRole(['volunteer', 'admin']), checkInTicket);

export default router;
