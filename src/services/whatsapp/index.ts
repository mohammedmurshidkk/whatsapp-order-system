/**
 * WhatsApp Provider Index
 * Exports the appropriate provider based on WHATSAPP_PROVIDER config
 *
 * Usage:
 *   import { sendMessage, sendReplyButtons } from './services/whatsapp';
 *
 * Toggle via environment:
 *   WHATSAPP_PROVIDER=meta   -> Uses Meta Business API
 *   WHATSAPP_PROVIDER=webjs  -> Uses whatsapp-web.js
 */

import { WHATSAPP_PROVIDER } from '../../config/constants';
import { ReplyButton, ListSection, ProviderStatus } from './types';
import * as metaProvider from './metaProvider';
import * as webjsProvider from './webjsProvider';
import { logger } from '../../utils/logger';

// Log which provider is active
logger.info(`WhatsApp Provider: ${WHATSAPP_PROVIDER}`);

// Select provider based on config
const isWebJS = WHATSAPP_PROVIDER === 'webjs';

/**
 * Send a text message
 */
export async function sendWhatsAppMessage(to: string, message: string): Promise<void> {
  if (isWebJS) {
    return webjsProvider.sendMessage(to, message);
  }
  return metaProvider.sendMessage(to, message);
}

/**
 * Send reply buttons
 * Meta: Native interactive buttons
 * WebJS: Text-based numbered list
 */
export async function sendReplyButtons(
  to: string,
  body: string,
  buttons: ReplyButton[]
): Promise<void> {
  if (isWebJS) {
    return webjsProvider.sendReplyButtons(to, body, buttons);
  }
  return metaProvider.sendReplyButtons(to, body, buttons);
}

/**
 * Send interactive list
 * Meta: Native interactive list
 * WebJS: Text-based numbered list
 */
export async function sendInteractiveListMessage(
  to: string,
  header: string,
  body: string,
  buttonText: string,
  sections: ListSection[]
): Promise<void> {
  if (isWebJS) {
    return webjsProvider.sendInteractiveList(to, header, body, buttonText, sections);
  }
  return metaProvider.sendInteractiveList(to, header, body, buttonText, sections);
}

/**
 * Send location request
 * Meta: Native location request button
 * WebJS: Text with instructions
 */
export async function sendLocationRequest(to: string, body: string): Promise<void> {
  if (isWebJS) {
    return webjsProvider.sendLocationRequest(to, body);
  }
  return metaProvider.sendLocationRequest(to, body);
}

/**
 * Send document (PDF, etc.)
 * Meta: Native document message
 * WebJS: MessageMedia attachment
 */
export async function sendDocument(
  to: string,
  documentUrl: string,
  filename: string,
  caption?: string
): Promise<void> {
  if (isWebJS) {
    return webjsProvider.sendDocument(to, documentUrl, filename, caption);
  }
  return metaProvider.sendDocument(to, documentUrl, filename, caption);
}

/**
 * Send image message
 * Meta: Native image message
 * WebJS: MessageMedia attachment
 */
export async function sendImage(
  to: string,
  imageUrl: string,
  caption?: string
): Promise<void> {
  if (isWebJS) {
    return webjsProvider.sendImage(to, imageUrl, caption);
  }
  return metaProvider.sendImage(to, imageUrl, caption);
}

/**
 * Verify webhook signature (Meta only)
 */
export function verifyWebhookSignature(signature: string, payload: string): boolean {
  // Only Meta uses webhook signatures
  if (isWebJS) {
    return true;
  }
  return metaProvider.verifyWebhookSignature(signature, payload);
}

/**
 * Verify webhook challenge (Meta only)
 */
export function verifyWebhookChallenge(
  mode: string,
  token: string,
  challenge: string
): string | null {
  // Only Meta uses webhook challenges
  if (isWebJS) {
    return null;
  }
  return metaProvider.verifyWebhookChallenge(mode, token, challenge);
}

/**
 * Get current provider status
 */
export function getProviderStatus(): ProviderStatus {
  if (isWebJS) {
    return webjsProvider.getStatus();
  }
  return metaProvider.getStatus();
}

/**
 * Get current provider name
 */
export function getProviderName(): 'meta' | 'webjs' {
  return WHATSAPP_PROVIDER;
}

/**
 * Mark a message as read (shows blue checkmarks to sender)
 * Only works with Meta provider
 */
export async function markAsRead(messageId: string): Promise<void> {
  if (isWebJS) {
    // WebJS handles read receipts automatically
    return;
  }
  return metaProvider.markAsRead(messageId);
}

/**
 * Send typing indicator
 * Note: Meta Cloud API does NOT support typing indicators
 * For Meta, this is a no-op. Consider using markAsRead() instead.
 */
export async function sendTypingIndicator(to: string): Promise<void> {
  if (isWebJS) {
    // Would call webjsProvider.sendTypingIndicator if implemented
    return;
  }
  return metaProvider.sendTypingIndicator(to);
}

// Re-export types for convenience
export * from './types';
