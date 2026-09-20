import express from 'express';
import { checkoutCart } from '../controllers/cartController.js';

const router = express.Router();

router.post('/checkout', checkoutCart);

export default router;
