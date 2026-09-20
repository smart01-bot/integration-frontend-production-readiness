import express from 'express';
import { getCampaignLanding, getCampaignsList, trackCampaignClick } from '../controllers/campaignController.js';

const router = express.Router();

router.get('/landing', getCampaignLanding);
router.get('/list', getCampaignsList);
router.post('/track', trackCampaignClick);

export default router;
