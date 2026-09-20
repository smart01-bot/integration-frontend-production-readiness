import express from 'express';
import { getMyCollectible, verifyCertificateByHash, generateFrame, issueCollectible } from '../controllers/collectibleController.js';
import auth from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';

const router = express.Router();

// Public verification for QR codes on certificates — intentionally unauthenticated
router.get('/verify/:hash', verifyCertificateByHash);
router.get('/my-certificate', auth(), getMyCollectible);
router.post('/frame', auth(), generateFrame);
router.post('/issue', auth(), requireRole(['admin']), issueCollectible);

export default router;
