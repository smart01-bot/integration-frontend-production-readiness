import express from 'express';
import { 
  getCommunicationTemplates, 
  previewRenderedTemplate, 
  sendTestCommunication, 
  getCommunicationLogs 
} from '../controllers/communicationController.js';
import auth from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';

const router = express.Router();

router.use(auth());
router.use(requireRole(['admin']));

router.get('/templates', getCommunicationTemplates);
router.post('/preview', previewRenderedTemplate);
router.post('/send-test', sendTestCommunication);
router.get('/logs', getCommunicationLogs);

export default router;
