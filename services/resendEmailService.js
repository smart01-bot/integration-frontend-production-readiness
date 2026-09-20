import axios from 'axios';

/**
 * Resend Transactional Email Service
 * Handles event confirmations, reminders, and briefings via the Resend API.
 * (Previously referenced by name throughout the codebase — including a
 * hardcoded "READY" status on the health check endpoint — but never
 * actually implemented. This was the missing piece.)
 */
class ResendEmailService {
  constructor() {
    this.apiKey = process.env.RESEND_API_KEY;
    this.apiUrl = 'https://api.resend.com/emails';
    this.fromAddress = process.env.EMAIL_FROM || 'Tour de Rotary DSM <no-reply@tourderotary.co.tz>';
  }

  isConfigured() {
    return Boolean(this.apiKey) && !this.apiKey.includes('your_') && !this.apiKey.startsWith('demo_');
  }

  /**
   * Send a transactional email via Resend.
   */
  async sendEmail({ to, subject, html, text }) {
    if (!this.isConfigured()) {
      console.warn(`[Resend Email] RESEND_API_KEY not configured. Dispatch skipped for recipient: ${to}`);
      return {
        success: false,
        status: 'UNCONFIGURED',
        warning: 'RESEND_API_KEY is not configured in .env. Live email requires active API credentials.',
        recipient: to
      };
    }

    try {
      const response = await axios.post(
        this.apiUrl,
        {
          from: this.fromAddress,
          to: [to],
          subject,
          html: html || undefined,
          text: text || undefined
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 8000
        }
      );

      return {
        success: true,
        data: response.data,
        recipient: to,
        status: 'DELIVERED'
      };
    } catch (error) {
      console.error('[Resend Email Error]:', error.response?.data || error.message);
      return {
        success: false,
        status: 'FAILED',
        error: error.response?.data?.message || error.message,
        recipient: to
      };
    }
  }
}

const resendServiceInstance = new ResendEmailService();
export default resendServiceInstance;
