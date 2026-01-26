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
import { ReplyButton, ListSection, ProviderStatus, TemplateMessage } from './types';
import * as metaProvider from './metaProvider';
import * as webjsProvider from './webjsProvider';
import { logger } from '../../utils/logger';
import { trackWhatsAppUsage, MessageType } from '../usageService';

// Log which provider is active
logger.info(`WhatsApp Provider: ${WHATSAPP_PROVIDER}`);

// Select provider based on config
const isWebJS = WHATSAPP_PROVIDER === 'webjs';

/**
 * Send a text message
 * @param to - Recipient phone number
 * @param message - Text message to send
 * @param businessId - Business ID for multi-tenant credential lookup and usage tracking
 * @returns WhatsApp message ID if successful, null otherwise
 */
export async function sendWhatsAppMessage(to: string, message: string, businessId?: string): Promise<string | null> {
  try {
    let messageId: string | null = null;
    if (isWebJS) {
      await webjsProvider.sendMessage(to, message);
      // WebJS doesn't return message ID in same format
    } else {
      messageId = await metaProvider.sendMessage(to, message, businessId) as string;
    }
    // Track successful send
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'text', success: true }).catch(() => { });
    }
    return messageId;
  } catch (error) {
    // Track failed send
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'text', success: false }).catch(() => { });
    }
    throw error;
  }
}

/**
 * Send reply buttons
 * Meta: Native interactive buttons
 * WebJS: Text-based numbered list
 * @param to - Recipient phone number
 * @param body - Button message body
 * @param buttons - Reply buttons (max 3)
 * @param businessId - Business ID for multi-tenant credential lookup and usage tracking
 */
export async function sendReplyButtons(
  to: string,
  body: string,
  buttons: ReplyButton[],
  businessId?: string
): Promise<void> {
  try {
    if (isWebJS) {
      await webjsProvider.sendReplyButtons(to, body, buttons);
    } else {
      await metaProvider.sendReplyButtons(to, body, buttons, businessId);
    }
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'interactive', success: true }).catch(() => { });
    }
  } catch (error) {
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'interactive', success: false }).catch(() => { });
    }
    throw error;
  }
}

/**
 * Send interactive list
 * Meta: Native interactive list
 * WebJS: Text-based numbered list
 * @param to - Recipient phone number
 * @param header - List header text
 * @param body - List body text
 * @param buttonText - Button text to open list
 * @param sections - List sections with rows
 * @param businessId - Business ID for multi-tenant credential lookup and usage tracking
 */
export async function sendInteractiveListMessage(
  to: string,
  header: string,
  body: string,
  buttonText: string,
  sections: ListSection[],
  businessId?: string
): Promise<void> {
  try {
    if (isWebJS) {
      await webjsProvider.sendInteractiveList(to, header, body, buttonText, sections);
    } else {
      await metaProvider.sendInteractiveList(to, header, body, buttonText, sections, businessId);
    }
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'interactive', success: true }).catch(() => { });
    }
  } catch (error) {
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'interactive', success: false }).catch(() => { });
    }
    throw error;
  }
}

/**
 * Send location request
 * Meta: Native location request button
 * WebJS: Text with instructions
 * @param to - Recipient phone number
 * @param body - Message body explaining why location is needed
 * @param businessId - Business ID for multi-tenant credential lookup and usage tracking
 */
export async function sendLocationRequest(to: string, body: string, businessId?: string): Promise<void> {
  try {
    if (isWebJS) {
      await webjsProvider.sendLocationRequest(to, body);
    } else {
      await metaProvider.sendLocationRequest(to, body, businessId);
    }
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'location', success: true }).catch(() => { });
    }
  } catch (error) {
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'location', success: false }).catch(() => { });
    }
    throw error;
  }
}

/**
 * Send template message
 * @param to - Recipient phone number
 * @param template - Template message configuration
 * @param businessId - Business ID for multi-tenant credential lookup and usage tracking
 */
export async function sendTemplate(to: string, template: TemplateMessage, businessId?: string): Promise<void> {
  try {
    if (isWebJS) {
      await webjsProvider.sendTemplate(to, template);
    } else {
      await metaProvider.sendTemplate(to, template, businessId);
    }
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'template', success: true }).catch(() => { });
    }
  } catch (error) {
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'template', success: false }).catch(() => { });
    }
    throw error;
  }
}

/**
 * Send document (PDF, etc.)
 * Meta: Native document message
 * WebJS: MessageMedia attachment
 * @param to - Recipient phone number
 * @param documentUrl - URL to the document
 * @param filename - Filename to display
 * @param caption - Optional caption
 * @param businessId - Business ID for multi-tenant credential lookup and usage tracking
 */
export async function sendDocument(
  to: string,
  documentUrl: string,
  filename: string,
  caption?: string,
  businessId?: string
): Promise<void> {
  try {
    if (isWebJS) {
      await webjsProvider.sendDocument(to, documentUrl, filename, caption);
    } else {
      await metaProvider.sendDocument(to, documentUrl, filename, caption, businessId);
    }
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'document', success: true }).catch(() => { });
    }
  } catch (error) {
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'document', success: false }).catch(() => { });
    }
    throw error;
  }
}

/**
 * Send image message
 * Meta: Native image message
 * WebJS: MessageMedia attachment
 * @param to - Recipient phone number
 * @param imageUrl - URL to the image
 * @param caption - Optional caption
 * @param businessId - Business ID for multi-tenant credential lookup and usage tracking
 */
export async function sendImage(
  to: string,
  imageUrl: string,
  caption?: string,
  businessId?: string
): Promise<void> {
  try {
    if (isWebJS) {
      await webjsProvider.sendImage(to, imageUrl, caption);
    } else {
      await metaProvider.sendImage(to, imageUrl, caption, businessId);
    }
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'image', success: true }).catch(() => { });
    }
  } catch (error) {
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'image', success: false }).catch(() => { });
    }
    throw error;
  }
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
 * @param messageId - WhatsApp message ID to mark as read
 * @param businessId - Business ID for multi-tenant credential lookup
 */
export async function markAsRead(messageId: string, businessId?: string): Promise<void> {
  if (isWebJS) {
    // WebJS handles read receipts automatically
    return;
  }
  return metaProvider.markAsRead(messageId, businessId);
}

/**
 * Send typing indicator
 * Note: Meta Cloud API does NOT support typing indicators
 * For Meta, this is a no-op. Consider using markAsRead() instead.
 * @param to - Recipient phone number
 * @param businessId - Business ID for multi-tenant credential lookup
 */
export async function sendTypingIndicator(to: string, businessId?: string): Promise<void> {
  if (isWebJS) {
    // Would call webjsProvider.sendTypingIndicator if implemented
    return;
  }
  return metaProvider.sendTypingIndicator(to, businessId);
}

/**
 * Track an inbound WhatsApp message
 * Call this from webhook handler when receiving messages
 */
export function trackInboundMessage(businessId: string, messageType: MessageType = 'text'): void {
  trackWhatsAppUsage({
    businessId,
    direction: 'inbound',
    messageType,
    success: true,
  }).catch(() => { });
}

/**
 * Get message templates from Meta API
 * Only works with Meta provider
 * @param statusFilter - Optional filter by template status
 * @param businessId - Business ID for multi-tenant credential lookup
 */
export async function getMessageTemplates(statusFilter?: 'APPROVED' | 'PENDING' | 'REJECTED', businessId?: string) {
  if (isWebJS) {
    throw new Error('Message templates are only available with Meta WhatsApp API');
  }
  return metaProvider.getMessageTemplates(statusFilter, businessId);
}

/**
 * Parse template parameters
 * Returns info about required parameters for a template
 */
export function parseTemplateParameters(template: import('./types').MetaMessageTemplate) {
  return metaProvider.parseTemplateParameters(template);
}

// Re-export types for convenience
export * from './types';
export { TemplateMessage, TemplateComponent, TemplateParameter, MetaMessageTemplate, MetaTemplateComponent } from './types';
