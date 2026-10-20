/**
 * Payment & Card Processing Service
 * Centralizes validation routines, Luhn checksum calculation, and card brand identification.
 */

export function validateLuhnChecksum(digits: string): boolean {
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits.charAt(i), 10);
    if (isNaN(n)) return false;
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

export function identifyCardBrand(digits: string): string {
  if (/^4/.test(digits)) return 'Visa';
  if (/^(5[1-5]|222[1-9]|22[3-9]|2[3-6]|27[01]|2720)/.test(digits))
    return 'Mastercard';
  if (/^3[47]/.test(digits)) return 'American Express';
  if (
    /^(60|65|81|82|508)/.test(digits) ||
    /^35(2[89]|[3-8][0-9])/.test(digits)
  )
    return 'RuPay';
  if (/^(50|5[6-8]|6\d)/.test(digits)) return 'Maestro';
  return 'Credit / Debit Card';
}

export function validateCardExpiration(exp: string): {
  valid: boolean;
  message?: string;
} {
  const trimmed = String(exp || '').trim();
  const match = trimmed.match(/^(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) {
    return {
      valid: false,
      message: 'Expiry date must be in MM/YY format (e.g. 12/28)',
    };
  }
  const month = parseInt(match[1] || '0', 10);
  let year = parseInt(match[2] || '0', 10);
  if (month < 1 || month > 12) {
    return {
      valid: false,
      message: 'Invalid card expiry month (must be 01 - 12)',
    };
  }
  if (year < 100) year += 2000;
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  if (year < currentYear || (year === currentYear && month < currentMonth)) {
    return {
      valid: false,
      message: 'Card has expired. Please use an active card.',
    };
  }
  if (year > currentYear + 30) {
    return { valid: false, message: 'Invalid expiry year.' };
  }
  return { valid: true };
}

