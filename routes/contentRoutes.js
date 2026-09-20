import express from 'express';
import { getPublicContent } from '../controllers/contentController.js';

const router = express.Router();

// Public, unauthenticated: the frontend homepage reads this before login.
router.get('/', getPublicContent);

export default router;
