export function isValidPhoneNumber(phone: string): boolean {
  // Basic validation: should be digits only and reasonable length
  const cleaned = phone.replace(/\D/g, '');
  return cleaned.length >= 10 && cleaned.length <= 15;
}

export function sanitizePhoneNumber(phone: string): string {
  // Remove all non-digit characters
  return phone.replace(/\D/g, '');
}

export function isValidMessage(message: string): boolean {
  return typeof message === 'string' && message.trim().length > 0;
}

export function sanitizeMessage(message: string): string {
  return message.trim();
}
