/**
 * Meta WhatsApp Business API Provider
 * Official WhatsApp API via Meta Graph API
 *
 * Supports multi-tenant: credentials can be loaded per-business from DB
 * Falls back to environment variables for backward compatibility
 */

import axios from 'axios';
import crypto from 'crypto';
import { WHATSAPP_API_VERSION } from '../../config/constants';
import { logger } from '../../utils/logger';
import { WhatsAppProvider, ReplyButton, ListSection, ProviderStatus, TemplateMessage, MetaMessageTemplate, MetaTemplateResponse } from './types';
import { logMessageSend, logMessageError, mockMessageSend } from './common';
import { getMetaCredentials, MetaCredentials } from '../whatsappConnectionService';

const WHATSAPP_API_BASE = `https://graph.facebook.com/${WHATSAPP_API_VERSION}`;

/**
 * Get Meta API configuration for a business
 * @param businessId - Optional business ID for multi-tenant lookup
 * @returns MetaCredentials or null if not configured
 */
async function getConfig(businessId?: string): Promise<MetaCredentials | null> {
  return getMetaCredentials(businessId);
}

/**
 * Get Meta API configuration (sync version for backward compatibility)
 * Only uses environment variables
 */
function getConfigSync(): { phoneNumberId: string | undefined; accessToken: string | undefined } {
  return {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
  };
}

/**
 * Check if Meta API is configured (sync - env vars only)
 */
function isConfiguredSync(): boolean {
  const { phoneNumberId, accessToken } = getConfigSync();
  return !!(phoneNumberId && accessToken);
}

/**
 * Check if Meta API is configured for a business
 */
async function isConfigured(businessId?: string): Promise<boolean> {
  const config = await getConfig(businessId);
  return config !== null;
}

/**
 * Send a text message via Meta API
 * @param to - Recipient phone number
 * @param message - Text message to send
 * @param businessId - Optional business ID for multi-tenant credential lookup
 */
export async function sendMessage(to: string, message: string, businessId?: string): Promise<void> {
  const config = await getConfig(businessId);

  if (!config) {
    mockMessageSend(to, message);
    return;
  }

  const { phoneNumberId, accessToken } = config;

  try {
    await axios.post(
      `${WHATSAPP_API_BASE}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: {
          body: message,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    logMessageSend('Meta', to, message);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('Meta WhatsApp API error', {
        status: error.response?.status,
        data: error.response?.data,
      });
    } else {
      logMessageError('Meta', to, error);
    }
  }
}

/**
 * Send reply buttons via Meta API
 * @param to - Recipient phone number
 * @param body - Button message body
 * @param buttons - Reply buttons (max 3)
 * @param businessId - Optional business ID for multi-tenant credential lookup
 */
export async function sendReplyButtons(
  to: string,
  body: string,
  buttons: ReplyButton[],
  businessId?: string
): Promise<void> {
  const config = await getConfig(businessId);

  if (!config) {
    logger.info(`[Meta Mock] Reply Buttons to: ${to}`);
    logger.info(`[Meta Mock] Body: ${body}`);
    logger.info(`[Meta Mock] Buttons: ${JSON.stringify(buttons)}`);
    return;
  }

  const { phoneNumberId, accessToken } = config;

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.slice(0, 3).map((btn) => ({
          type: 'reply',
          reply: { id: btn.id, title: btn.title.substring(0, 20) },
        })),
      },
    },
  };

  try {
    await axios.post(`${WHATSAPP_API_BASE}/${phoneNumberId}/messages`, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    logger.info(`Meta reply buttons sent to ${to}`);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('Meta API error (reply buttons)', {
        status: error.response?.status,
        data: error.response?.data,
      });
    } else {
      logMessageError('Meta', to, error);
    }
  }
}

/**
 * Send interactive list via Meta API
 * @param to - Recipient phone number
 * @param header - List header text
 * @param body - List body text
 * @param buttonText - Button text to open list
 * @param sections - List sections with rows
 * @param businessId - Optional business ID for multi-tenant credential lookup
 */
export async function sendInteractiveList(
  to: string,
  header: string,
  body: string,
  buttonText: string,
  sections: ListSection[],
  businessId?: string
): Promise<void> {
  const config = await getConfig(businessId);

  if (!config) {
    logger.info(`[Meta Mock] Interactive List to: ${to}`);
    logger.info(`[Meta Mock] Header: ${header}, Body: ${body}`);
    logger.info(`[Meta Mock] Sections: ${JSON.stringify(sections)}`);
    return;
  }

  const { phoneNumberId, accessToken } = config;

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: header.substring(0, 60) },
      body: { text: body.substring(0, 1024) },
      action: {
        button: buttonText.substring(0, 20),
        sections: sections.map((section) => ({
          title: section.title.substring(0, 24),
          rows: section.rows.slice(0, 10).map((row) => ({
            id: row.id,
            title: row.title.substring(0, 24),
            description: row.description?.substring(0, 72),
          })),
        })),
      },
    },
  };

  try {
    await axios.post(`${WHATSAPP_API_BASE}/${phoneNumberId}/messages`, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    logger.info(`Meta interactive list sent to ${to}`);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('Meta API error (interactive list)', {
        status: error.response?.status,
        data: error.response?.data,
      });
    } else {
      logMessageError('Meta', to, error);
    }
  }
}

/**
 * Send document via Meta API
 * @param to - Recipient phone number
 * @param documentUrl - URL to the document
 * @param filename - Filename to display
 * @param caption - Optional caption
 * @param businessId - Optional business ID for multi-tenant credential lookup
 */
export async function sendDocument(
  to: string,
  documentUrl: string,
  filename: string,
  caption?: string,
  businessId?: string
): Promise<void> {
  const config = await getConfig(businessId);

  if (!config) {
    logger.info(`[Meta Mock] Document to: ${to}`);
    logger.info(`[Meta Mock] URL: ${documentUrl}`);
    logger.info(`[Meta Mock] Filename: ${filename}`);
    if (caption) logger.info(`[Meta Mock] Caption: ${caption}`);
    return;
  }

  const { phoneNumberId, accessToken } = config;

  const payload: {
    messaging_product: string;
    to: string;
    type: string;
    document: {
      link: string;
      filename: string;
      caption?: string;
    };
  } = {
    messaging_product: 'whatsapp',
    to,
    type: 'document',
    document: {
      link: documentUrl,
      filename,
    },
  };

  if (caption) {
    payload.document.caption = caption;
  }

  try {
    await axios.post(`${WHATSAPP_API_BASE}/${phoneNumberId}/messages`, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    logger.info(`Meta document sent to ${to}: ${filename}`);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('Meta API error (document)', {
        status: error.response?.status,
        data: error.response?.data,
      });
    } else {
      logMessageError('Meta', to, error);
    }
  }
}

/**
 * Send image via Meta API
 * @param to - Recipient phone number
 * @param imageUrl - URL to the image
 * @param caption - Optional caption
 * @param businessId - Optional business ID for multi-tenant credential lookup
 */
export async function sendImage(
  to: string,
  imageUrl: string,
  caption?: string,
  businessId?: string
): Promise<void> {
  const config = await getConfig(businessId);

  if (!config) {
    logger.info(`[Meta Mock] Image to: ${to}`);
    logger.info(`[Meta Mock] URL: ${imageUrl}`);
    if (caption) logger.info(`[Meta Mock] Caption: ${caption}`);
    return;
  }

  const { phoneNumberId, accessToken } = config;

  const payload: {
    messaging_product: string;
    to: string;
    type: string;
    image: {
      link: string;
      caption?: string;
    };
  } = {
    messaging_product: 'whatsapp',
    to,
    type: 'image',
    image: {
      link: imageUrl,
    },
  };

  if (caption) {
    payload.image.caption = caption;
  }

  try {
    await axios.post(`${WHATSAPP_API_BASE}/${phoneNumberId}/messages`, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    logger.info(`Meta image sent to ${to}`);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('Meta API error (image)', {
        status: error.response?.status,
        data: error.response?.data,
      });
    } else {
      logMessageError('Meta', to, error);
    }
  }
}

/**
 * Send location request via Meta API
 * @param to - Recipient phone number
 * @param body - Message body explaining why location is needed
 * @param businessId - Optional business ID for multi-tenant credential lookup
 */
export async function sendLocationRequest(to: string, body: string, businessId?: string): Promise<void> {
  const config = await getConfig(businessId);

  if (!config) {
    logger.info(`[Meta Mock] Location Request to: ${to}`);
    logger.info(`[Meta Mock] Body: ${body}`);
    return;
  }

  const { phoneNumberId, accessToken } = config;

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'location_request_message',
      body: { text: body.substring(0, 1024) },
      action: {
        name: 'send_location',
      },
    },
  };

  try {
    await axios.post(`${WHATSAPP_API_BASE}/${phoneNumberId}/messages`, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    logger.info(`Meta location request sent to ${to}`);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('Meta API error (location request)', {
        status: error.response?.status,
        data: error.response?.data,
      });
    } else {
      logMessageError('Meta', to, error);
    }
  }
}

/**
 * Verify webhook signature from Meta
 * Note: For multi-tenant, we verify against global secret (all businesses share webhook endpoint)
 * In future, could look up business-specific secret if needed
 * @param signature - X-Hub-Signature-256 header value
 * @param payload - Raw request body
 * @param webhookSecret - Optional webhook secret (uses env var if not provided)
 */
export function verifyWebhookSignature(signature: string, payload: string, webhookSecret?: string): boolean {
  const secret = webhookSecret || process.env.WHATSAPP_WEBHOOK_SECRET;

  if (!secret) {
    logger.warn('Webhook secret not configured, skipping signature verification');
    return true;
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    const signatureHash = signature.replace('sha256=', '');

    return crypto.timingSafeEqual(
      Buffer.from(signatureHash),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    logger.error('Signature verification failed', error);
    return false;
  }
}

/**
 * Verify webhook challenge from Meta (for webhook setup)
 * Note: This uses env var since it's called during initial setup before business is known
 * @param mode - Verification mode (should be 'subscribe')
 * @param token - Verification token from Meta
 * @param challenge - Challenge string to return
 * @param verifyTokenOverride - Optional token override (uses env var if not provided)
 */
export function verifyWebhookChallenge(
  mode: string,
  token: string,
  challenge: string,
  verifyTokenOverride?: string
): string | null {
  const verifyToken = verifyTokenOverride || process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('Meta webhook verified successfully');
    return challenge;
  }

  logger.warn('Meta webhook verification failed', { mode, token });
  return null;
}

/**
 * Mark a message as read (shows blue checkmarks)
 * Meta Cloud API doesn't support typing indicators, but marking as read
 * gives visual feedback that the message was received
 * @param messageId - WhatsApp message ID to mark as read
 * @param businessId - Optional business ID for multi-tenant credential lookup
 */
export async function markAsRead(messageId: string, businessId?: string): Promise<void> {
  if (!messageId) {
    return;
  }

  const config = await getConfig(businessId);

  if (!config) {
    return;
  }

  const { phoneNumberId, accessToken } = config;

  try {
    await axios.post(
      `${WHATSAPP_API_BASE}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    logger.debug(`Message marked as read: ${messageId}`);
  } catch (error) {
    // Don't throw - marking as read is not critical
    logger.debug('Failed to mark message as read', error);
  }
}

/**
 * Show typing indicator - NOT supported by Meta Cloud API
 * This is a no-op for Meta, but kept for interface compatibility
 */
export async function sendTypingIndicator(_to: string, _businessId?: string): Promise<void> {
  // Meta Cloud API doesn't support typing indicators
  // The markAsRead function can be used instead to show blue checkmarks
  logger.debug('Typing indicator not supported by Meta Cloud API');
}

/**
 * Get provider status (sync - uses env vars)
 */
export function getStatus(): ProviderStatus {
  const configured = isConfiguredSync();
  return {
    ready: configured,
    provider: 'meta',
    needsAuth: false,
    error: configured ? undefined : 'Meta API credentials not configured',
  };
}

/**
 * Get provider status for a specific business (async)
 */
export async function getStatusForBusiness(businessId: string): Promise<ProviderStatus> {
  const configured = await isConfigured(businessId);
  return {
    ready: configured,
    provider: 'meta',
    needsAuth: false,
    error: configured ? undefined : 'Meta API credentials not configured for this business',
  };
}

/**
 * Send template message via Meta API
 * @param to - Recipient phone number
 * @param template - Template message configuration
 * @param businessId - Optional business ID for multi-tenant credential lookup
 */
export async function sendTemplate(to: string, template: TemplateMessage, businessId?: string): Promise<void> {
  const config = await getConfig(businessId);

  if (!config) {
    logger.info(`[Meta Mock] Template to: ${to}`);
    logger.info(`[Meta Mock] Template Name: ${template.name}`);
    logger.info(`[Meta Mock] Language: ${template.language.code}`);
    if (template.components) {
      logger.info(`[Meta Mock] Components: ${JSON.stringify(template.components)}`);
    }
    return;
  }

  const { phoneNumberId, accessToken } = config;

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: template.name,
      language: template.language,
      components: template.components,
    },
  };

  try {
    await axios.post(`${WHATSAPP_API_BASE}/${phoneNumberId}/messages`, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    logger.info(`Meta template sent to ${to}: ${template.name}`);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('Meta API error (template)', {
        status: error.response?.status,
        data: error.response?.data,
      });
    } else {
      logMessageError('Meta', to, error);
    }
    throw error;
  }
}

/**
 * Get WhatsApp Business Account ID
 * Can be configured in DB or environment variables
 * @param businessId - Optional business ID for multi-tenant lookup
 */
async function getWabaId(businessId?: string): Promise<string | null> {
  // Try to get from business-specific config first
  const config = await getConfig(businessId);
  if (config?.businessAccountId) {
    return config.businessAccountId;
  }

  // Fall back to env var
  const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  if (wabaId) {
    return wabaId;
  }

  logger.warn('WHATSAPP_BUSINESS_ACCOUNT_ID not configured for business or in environment variables.');
  return null;
}

/**
 * Fetch message templates from Meta API
 * Returns all templates for the WhatsApp Business Account
 * @param statusFilter - Optional filter by template status
 * @param businessId - Optional business ID for multi-tenant credential lookup
 */
export async function getMessageTemplates(
  statusFilter?: 'APPROVED' | 'PENDING' | 'REJECTED',
  businessId?: string
): Promise<MetaMessageTemplate[]> {
  const config = await getConfig(businessId);
  const wabaId = await getWabaId(businessId);

  if (!wabaId || !config?.accessToken) {
    logger.error('Cannot fetch templates: WHATSAPP_BUSINESS_ACCOUNT_ID or access token not configured');
    throw new Error('WhatsApp Business Account ID not configured. Please set WHATSAPP_BUSINESS_ACCOUNT_ID environment variable or configure in database.');
  }

  try {
    const params: Record<string, string> = {
      fields: 'id,name,status,category,language,components',
      limit: '100',
    };

    if (statusFilter) {
      params.status = statusFilter;
    }

    const response = await axios.get<MetaTemplateResponse>(
      `${WHATSAPP_API_BASE}/${wabaId}/message_templates`,
      {
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
        },
        params,
      }
    );

    logger.info(`Fetched ${response.data.data.length} message templates from Meta`);
    return response.data.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('Meta API error (get templates)', {
        status: error.response?.status,
        data: error.response?.data,
      });
      throw new Error(error.response?.data?.error?.message || 'Failed to fetch templates from Meta');
    }
    throw error;
  }
}

/**
 * Parse template to extract parameter info
 * Returns the number of parameters needed for each component
 */
export function parseTemplateParameters(template: MetaMessageTemplate): {
  headerParams: number;
  headerType: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'NONE';
  bodyParams: number;
  buttonParams: Array<{ index: number; type: string }>;
} {
  let headerParams = 0;
  let headerType: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'NONE' = 'NONE';
  let bodyParams = 0;
  const buttonParams: Array<{ index: number; type: string }> = [];

  for (const component of template.components) {
    if (component.type === 'HEADER') {
      headerType = component.format || 'TEXT';
      if (component.format === 'TEXT' && component.text) {
        // Count {{1}}, {{2}}, etc. in header text
        const matches = component.text.match(/\{\{\d+\}\}/g);
        headerParams = matches ? matches.length : 0;
      } else if (component.format === 'IMAGE' || component.format === 'VIDEO' || component.format === 'DOCUMENT') {
        // Media headers need 1 parameter (the media URL)
        headerParams = 1;
      }
    } else if (component.type === 'BODY' && component.text) {
      // Count {{1}}, {{2}}, etc. in body text
      const matches = component.text.match(/\{\{\d+\}\}/g);
      bodyParams = matches ? matches.length : 0;
    } else if (component.type === 'BUTTONS' && component.buttons) {
      component.buttons.forEach((button, index) => {
        if (button.type === 'URL' && button.url?.includes('{{1}}')) {
          buttonParams.push({ index, type: 'url' });
        }
      });
    }
  }

  return { headerParams, headerType, bodyParams, buttonParams };
}

/**
 * Export as provider interface
 */
export const metaProvider: WhatsAppProvider = {
  sendMessage,
  sendReplyButtons,
  sendInteractiveList,
  sendLocationRequest,
  sendTemplate,
};
