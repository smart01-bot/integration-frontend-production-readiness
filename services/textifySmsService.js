import axios from 'axios';

/**
 * Textify Africa SMS Integration Service
 * Real transactional SMS gateway for participant passes and inventory alerts
 */
class TextifySmsService {
  constructor() {
    this.apiKey = process.env.TEXTIFY_API_KEY;
    this.senderId = process.env.TEXTIFY_SENDER_ID || 'ROTARY-DSM';
    this.apiUrl = process.env.TEXTIFY_API_URL || 'https://api.textify.africa/v1/sms/send';
  }

  /**
   * Send SMS via Textify Africa gateway
   */
  async sendSms({ to, message }) {
    if (!this.apiKey || this.apiKey.includes('your_') || this.apiKey.startsWith('demo_')) {
      console.warn(`[Textify Africa SMS] TEXTIFY_API_KEY not configured. Dispatch skipped for recipient: ${to}`);
      return {
        success: false,
        status: 'UNCONFIGURED',
        warning: 'TEXTIFY_API_KEY is not configured in .env. Live SMS requires active API credentials.',
        recipient: to
      };
    }

    try {
      const response = await axios.post(
        this.apiUrl,
        {
          sender: this.senderId,
          recipient: to,
          message: message
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
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
      console.error('[Textify Africa SMS Error]:', error.response?.data || error.message);
      return {
        success: false,
        status: 'FAILED',
        error: error.response?.data?.message || error.message,
        recipient: to
      };
    }
  }

  /**
   * Template: Registration Confirmation & Ticket Pass
   */
  async sendTicketIssuedSms(phoneNumber, { fullName, bibNumber, activityTitle, qrToken }) {
    const message = `Karibu Tour de Rotary DSM 2026, ${fullName}! Your pass for ${activityTitle} is confirmed. BIB: ${bibNumber}. View your entry QR pass at: https://tourderotary.co.tz/pass/${qrToken}`;
    return this.sendSms({ to: phoneNumber, message });
  }

  /**
   * Template: Day 4 Apparel Reservation Reminder
   */
  async sendDay4ReservationReminder(phoneNumber, { orderNumber, totalTsh, daysRemaining = 3 }) {
    const message = `Reminder from Tour de Rotary DSM: Your reserved official jersey in Order #${orderNumber} (TSh ${totalTsh.toLocaleString()}) is held for ${daysRemaining} more days. Complete payment at https://tourderotary.co.tz/pay/${orderNumber}`;
    return this.sendSms({ to: phoneNumber, message });
  }

  /**
   * Template: Day 6 Urgent Final Expiry Warning
   */
  async sendDay6FinalWarning(phoneNumber, { orderNumber, totalTsh }) {
    const message = `URGENT: Your merchandise reservation #${orderNumber} expires in 24 hours. Unpaid jerseys will be released to public stock tonight. Pay now: https://tourderotary.co.tz/pay/${orderNumber}`;
    return this.sendSms({ to: phoneNumber, message });
  }
}

const textifyServiceInstance = new TextifySmsService();
export const sendSmsNotification = (to, message) => textifyServiceInstance.sendSms({ to, message });
export default textifyServiceInstance;
