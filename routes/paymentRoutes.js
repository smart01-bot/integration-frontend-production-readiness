import express from 'express';
import rateLimit from 'express-rate-limit';
import { initiatePayment, handlePayMeWebhook, getPaymentStatus, getPaymentVerification, retryPayment } from '../controllers/paymentController.js';

const router = express.Router();

// These routes are intentionally reachable without auth() — checkout in this
// app is guest-based (an order/profile is created without a Supabase auth
// session, see cartController), so there is no session to gate on. That
// means order_number is the only "secret" protecting these endpoints, and
// TDR-2026-##### only has a 90,000-value space. Without a limiter, an
// attacker can script through the whole range against /status/:order_number
// to harvest payment_method/payme_reference/total_tsh per order, or hammer
// /initiate and /retry to spam arbitrary phone numbers with USSD payment
// prompts. Rate limiting is the practical mitigation here, not auth().
const statusLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

const paymentActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payment requests, please try again later.' }
});

// PayMe calls this server-to-server; keep it generous so retried callbacks
// during a real traffic spike aren't dropped, but still bounded.
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false
});

router.post('/initiate', paymentActionLimiter, initiatePayment);
router.post('/payme/webhook', webhookLimiter, handlePayMeWebhook);
router.get('/status/:order_number', statusLimiter, getPaymentStatus);
router.get('/verify/:transactionRef', statusLimiter, getPaymentVerification);
router.post('/retry', paymentActionLimiter, retryPayment);

export default router;
