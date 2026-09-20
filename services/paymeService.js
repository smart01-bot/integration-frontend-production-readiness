import crypto from 'crypto';
import axios from 'axios';

/**
 * PayMe Africa Mobile Money Integration Service
 * Real gateway client for M-Pesa, Tigo Pesa, and Airtel Money
 */
class PayMeService {
  constructor() {
    this.apiKey = process.env.PAYME_API_KEY;
    this.webhookSecret = process.env.PAYME_WEBHOOK_SECRET;
    this.apiUrl = process.env.PAYME_API_URL || 'https://api.payme.africa/v1';
    this.merchantCode = process.env.PAYME_MERCHANT_CODE || 'ROTARY_DSM_2026';
    this.defaultCurrency = process.env.PAYME_DEFAULT_CURRENCY || 'TZS';
  }

  /**
   * Verify incoming PayMe webhook HMAC-SHA256 signature
   */
  verifyWebhookSignature(rawBody, signature) {
    if (!signature || !this.webhookSecret) return false;
    try {
      const computed = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody))
        .digest('hex');
      return computed === signature;
    } catch (err) {
      console.error('Webhook signature verification error:', err);
      return false;
    }
  }

  /**
   * Initiate real Mobile Money Payment via PayMe Africa API
   */
  async initiateMobilePayment({ orderNumber, amountTsh, phoneNumber, provider = 'mpesa' }) {
    if (!this.apiKey || this.apiKey.includes('your_') || this.apiKey.startsWith('demo_')) {
      console.warn('[PayMe Africa] Live PAYME_API_KEY not set in environment.');
      return {
        status: 'unconfigured',
        error: 'PAYME_API_KEY is not configured in .env. Live mobile money push requires production credentials.',
        order_number: orderNumber,
        amount_tsh: amountTsh,
        provider
      };
    }

    try {
      const response = await axios.post(
        `${this.apiUrl}/payments/initiate`,
        {
          merchant_code: this.merchantCode,
          order_number: orderNumber,
          amount: amountTsh,
          currency: this.defaultCurrency,
          customer_phone: phoneNumber,
          provider: provider.toLowerCase()
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      return response.data;
    } catch (error) {
      console.error('[PayMe Africa API Error]:', error.response?.data || error.message);
      return {
        status: 'failed',
        error: error.response?.data?.message || error.message,
        order_number: orderNumber
      };
    }
  }
}

export default new PayMeService();
