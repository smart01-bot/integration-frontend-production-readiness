import express from 'express';
import { getActivities, getActivityById } from '../controllers/activityController.js';

const router = express.Router();

router.get('/', getActivities);
router.get('/:id', getActivityById);

export default router;
