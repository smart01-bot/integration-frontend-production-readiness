import crypto from 'crypto';

/**
 * Tour de Rotary Dar es Salaam 2026 - Utility Helpers
 */

/**
 * Format currency in Tanzanian Shillings (TZS)
 */
export const formatTsh = (amount) => {
  return `TSh ${(Number(amount) || 0).toLocaleString('en-US')}`;
};

/**
 * Generate cryptographic verification token for ticket passes and QR codes
 */
export const generateSecureToken = (byteLength = 16) => {
  return crypto.randomBytes(byteLength).toString('hex');
};

/**
 * Generate standard BIB identifier
 */
export const formatBibNumber = (category = 'Cycling', sequence = 1) => {
  const prefix = category.substring(0, 3).toUpperCase();
  const padded = String(sequence).padStart(4, '0');
  return `${prefix}-2026-${padded}`;
};
