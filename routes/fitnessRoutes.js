import express from 'express';
import { getFitnessSyncStatus, syncStravaActivity } from '../controllers/fitnessController.js';
import auth from '../middleware/auth.js';

const router = express.Router();

router.use(auth());

router.get('/status', getFitnessSyncStatus);
router.post('/strava/sync', syncStravaActivity);

export default router;
