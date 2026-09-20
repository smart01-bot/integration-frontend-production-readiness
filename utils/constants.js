/**
 * Tour de Rotary Dar es Salaam 2026 - System Constants
 * Single source of truth for roles, categories, and payment providers
 */

export const ROLES = ['participant', 'volunteer', 'sponsor', 'partner', 'admin'];

export const ACTIVITY_CATEGORIES = ['Cycling', 'Running', 'Walking', 'Fitness', 'Wellness'];

export const TICKET_STATUSES = ['issued', 'checked_in', 'cancelled'];

export const ORDER_STATUSES = ['pending', 'paid', 'cancelled', 'refunded'];

export const PAYMENT_PROVIDERS = ['mpesa', 'tigopesa', 'airtel', 'halopesa', 'card'];

export const RESERVATION_POLICY = {
  HOLD_PERIOD_DAYS: 7,
  DAY4_WARNING_DAYS_REMAINING: 3,
  DAY6_WARNING_HOURS_REMAINING: 24
};

export const SPONSOR_TIERS = ['Title Partner', 'Platinum', 'Gold', 'Silver', 'Hydration Partner'];

export const PARTNER_TYPES = ['Emergency Medical', 'Police & Security', 'Municipal Council', 'Traffic & Route Marshals'];
