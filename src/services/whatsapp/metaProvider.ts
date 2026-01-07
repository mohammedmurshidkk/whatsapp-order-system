/**
 * Meta WhatsApp Business API Provider
 * Official WhatsApp API via Meta Graph API
 */

import axios from 'axios';
import crypto from 'crypto';
import { WHATSAPP_API_VERSION } from '../../config/constants';
import { logger } from '../../utils/logger';
import { WhatsAppProvider, ReplyButton, ListSection, ProviderStatus } from './types';
import { logMessageSend, logMessageError, mockMessageSend } from './common';

const WHATSAPP_API_BASE = `https://graph.facebook.com/${WHATSAPP_API_VERSION}`;

/**
 * Get Meta API configuration
 */
function getConfig() {
  return {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
  };
}

/**
 * Check if Meta API is configured
 */
function isConfigured(): boolean {
  const { phoneNumberId, accessToken } = getConfig();
  return !!(phoneNumberId && accessToken);
}

/**
 * Send a text message via Meta API
 */
export async function sendMessage(to: string, message: string): Promise<void> {
  const { phoneNumberId, accessToken } = getConfig();

  if (!isConfigured()) {
    mockMessageSend(to, message);
    return;
  }

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
 */
export async function sendReplyButtons(
  to: string,
  body: string,
  buttons: ReplyButton[]
): Promise<void> {
  const { phoneNumberId, accessToken } = getConfig();

  if (!isConfigured()) {
    logger.info(`[Meta Mock] Reply Buttons to: ${to}`);
    logger.info(`[Meta Mock] Body: ${body}`);
    logger.info(`[Meta Mock] Buttons: ${JSON.stringify(buttons)}`);
    return;
  }

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
 */
export async function sendInteractiveList(
  to: string,
  header: string,
  body: string,
  buttonText: string,
  sections: ListSection[]
): Promise<void> {
  const { phoneNumberId, accessToken } = getConfig();

  if (!isConfigured()) {
    logger.info(`[Meta Mock] Interactive List to: ${to}`);
    logger.info(`[Meta Mock] Header: ${header}, Body: ${body}`);
    logger.info(`[Meta Mock] Sections: ${JSON.stringify(sections)}`);
    return;
  }

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
 */
export async function sendDocument(
  to: string,
  documentUrl: string,
  filename: string,
  caption?: string
): Promise<void> {
  const { phoneNumberId, accessToken } = getConfig();

  if (!isConfigured()) {
    logger.info(`[Meta Mock] Document to: ${to}`);
    logger.info(`[Meta Mock] URL: ${documentUrl}`);
    logger.info(`[Meta Mock] Filename: ${filename}`);
    if (caption) logger.info(`[Meta Mock] Caption: ${caption}`);
    return;
  }

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
 */
export async function sendImage(
  to: string,
  imageUrl: string,
  caption?: string
): Promise<void> {
  const { phoneNumberId, accessToken } = getConfig();

  if (!isConfigured()) {
    logger.info(`[Meta Mock] Image to: ${to}`);
    logger.info(`[Meta Mock] URL: ${imageUrl}`);
    if (caption) logger.info(`[Meta Mock] Caption: ${caption}`);
    return;
  }

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
 */
export async function sendLocationRequest(to: string, body: string): Promise<void> {
  const { phoneNumberId, accessToken } = getConfig();

  if (!isConfigured()) {
    logger.info(`[Meta Mock] Location Request to: ${to}`);
    logger.info(`[Meta Mock] Body: ${body}`);
    return;
  }

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
 */
export function verifyWebhookSignature(signature: string, payload: string): boolean {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;

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
 */
export function verifyWebhookChallenge(
  mode: string,
  token: string,
  challenge: string
): string | null {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

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
 */
export async function markAsRead(messageId: string): Promise<void> {
  const { phoneNumberId, accessToken } = getConfig();

  if (!isConfigured() || !messageId) {
    return;
  }

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
export async function sendTypingIndicator(_to: string): Promise<void> {
  // Meta Cloud API doesn't support typing indicators
  // The markAsRead function can be used instead to show blue checkmarks
  logger.debug('Typing indicator not supported by Meta Cloud API');
}

/**
 * Get provider status
 */
export function getStatus(): ProviderStatus {
  return {
    ready: isConfigured(),
    provider: 'meta',
    needsAuth: false,
    error: isConfigured() ? undefined : 'Meta API credentials not configured',
  };
}

/**
 * Export as provider interface
 */
export const metaProvider: WhatsAppProvider = {
  sendMessage,
  sendReplyButtons,
  sendInteractiveList,
  sendLocationRequest,
};
