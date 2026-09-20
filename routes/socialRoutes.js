import express from 'express';
import { getTwibbonFrames, generateTwibbon, generatePublicFrame, getOpenGraphCard } from '../controllers/socialController.js';
import auth from '../middleware/auth.js';

const router = express.Router();

router.get('/twibbon/frames', getTwibbonFrames);
router.post('/twibbon/generate', auth(), generateTwibbon);
// Public, no-login frame generator (proposal flow F) — intentionally open.
router.post('/twibbon/public', generatePublicFrame);
router.get('/og/:bib_or_id', getOpenGraphCard);

export default router;
