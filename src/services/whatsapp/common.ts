/**
 * Common utilities shared between WhatsApp providers
 */

import { ReplyButton, ListSection } from './types';
import { logger } from '../../utils/logger';

/**
 * Normalize phone number to standard format (digits only)
 * Removes @c.us suffix, +, spaces, dashes
 */
export function normalizePhoneNumber(phone: string): string {
  return phone
    .replace('@c.us', '')
    .replace('@s.whatsapp.net', '')
    .replace(/[\s\-\+\(\)]/g, '');
}

/**
 * Format phone for whatsapp-web.js (add @c.us suffix)
 */
export function formatPhoneForWebJS(phone: string): string {
  const normalized = normalizePhoneNumber(phone);
  return `${normalized}@c.us`;
}

/**
 * Convert buttons to text format for providers that don't support interactive buttons
 */
export function buttonsToText(body: string, buttons: ReplyButton[]): string {
  const buttonLines = buttons
    .map((btn, i) => `${getNumberEmoji(i + 1)} *${btn.title}*`)
    .join('\n');

  return `${body}\n\n${buttonLines}\n\n_Reply with number or type your choice_`;
}

/**
 * Convert interactive list to text format for providers that don't support lists
 */
export function listToText(
  header: string,
  body: string,
  sections: ListSection[]
): string {
  let message = `*${header}*\n\n${body}\n\n`;

  let itemNumber = 1;
  for (const section of sections) {
    if (section.title) {
      message += `📍 *${section.title}*\n`;
    }
    for (const row of section.rows) {
      message += `${getNumberEmoji(itemNumber)} *${row.title}*`;
      if (row.description) {
        message += `\n   _${row.description}_`;
      }
      message += '\n';
      itemNumber++;
    }
    message += '\n';
  }

  message += `_Reply with number to select_`;

  return message;
}

/**
 * Convert location request to text format
 */
export function locationRequestToText(body: string): string {
  return `${body}\n\n📍 _To share location: Tap the + button → Location → Share your location_\n\n_Or simply type your full address_`;
}

/**
 * Get emoji number (1️⃣, 2️⃣, etc.)
 */
function getNumberEmoji(num: number): string {
  const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
  return emojis[num - 1] || `${num}.`;
}

/**
 * Log message send attempt
 */
export function logMessageSend(provider: string, to: string, preview: string): void {
  logger.info(`[${provider}] Sending to ${to}: ${preview.substring(0, 50)}...`);
}

/**
 * Log message send error
 */
export function logMessageError(provider: string, to: string, error: unknown): void {
  logger.error(`[${provider}] Failed to send to ${to}:`, error);
}

/**
 * Mock message send (for development when provider not configured)
 */
export function mockMessageSend(to: string, message: string): void {
  logger.info(`[WhatsApp Mock] To: ${to}`);
  logger.info(`[WhatsApp Mock] Message: ${message.substring(0, 100)}...`);
}
