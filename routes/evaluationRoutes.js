import express from 'express';
import { 
  submitEvaluationSurvey, 
  getEvaluationResults, 
  getScheduleCImpactReport 
} from '../controllers/evaluationController.js';
import auth from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';

const router = express.Router();

// Surveys accept anonymous and authenticated submissions per Schedule C
router.post('/survey', submitEvaluationSurvey);

// Aggregated results and the impact report are admin-only
router.get('/results', auth(), requireRole(['admin']), getEvaluationResults);
router.get('/impact-report', auth(), requireRole(['admin']), getScheduleCImpactReport);

export default router;
