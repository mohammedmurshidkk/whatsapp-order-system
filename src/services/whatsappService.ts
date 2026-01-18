import axios from 'axios';
import crypto from 'crypto';
import { WHATSAPP_API_VERSION } from '../config/constants';
import { logger } from '../utils/logger';
import { trackWhatsAppUsage, MessageType } from './usageService';

const WHATSAPP_API_BASE = `https://graph.facebook.com/${WHATSAPP_API_VERSION}`;

export async function sendWhatsAppMessage(
  to: string,
  message: string,
  businessId?: string
): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  // For MVP: log to console instead of actual API call
  if (!phoneNumberId || !accessToken) {
    logger.info(`[WhatsApp Mock] To: ${to}`);
    logger.info(`[WhatsApp Mock] Message: ${message}`);
    // Track mock usage too for testing
    if (businessId) {
      trackWhatsAppUsage({
        businessId,
        direction: 'outbound',
        messageType: 'text',
        success: true,
      }).catch(() => {});
    }
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

    logger.info(`WhatsApp message sent to ${to}`);

    // Track usage
    if (businessId) {
      trackWhatsAppUsage({
        businessId,
        direction: 'outbound',
        messageType: 'text',
        success: true,
      }).catch(() => {});
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('WhatsApp API error', {
        status: error.response?.status,
        data: error.response?.data,
      });
    } else {
      logger.error('Failed to send WhatsApp message', error);
    }

    // Track failed attempt
    if (businessId) {
      trackWhatsAppUsage({
        businessId,
        direction: 'outbound',
        messageType: 'text',
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      }).catch(() => {});
    }
    // Don't throw - we want to continue even if WhatsApp fails
  }
}

export function verifyWebhookSignature(
  signature: string,
  payload: string
): boolean {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;

  if (!secret) {
    logger.warn('Webhook secret not configured, skipping signature verification');
    return true; // For MVP, allow without verification
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

export function verifyWebhookChallenge(
  mode: string,
  token: string,
  challenge: string
): string | null {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('Webhook verified successfully');
    return challenge;
  }

  logger.warn('Webhook verification failed', { mode, token });
  return null;
}

/**
 * Send WhatsApp reply buttons (max 3 buttons)
 */
export async function sendReplyButtons(
  to: string,
  body: string,
  buttons: { id: string; title: string }[],
  businessId?: string
): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    logger.info(`[WhatsApp Mock] Reply Buttons to: ${to}`);
    logger.info(`[WhatsApp Mock] Body: ${body}`);
    logger.info(`[WhatsApp Mock] Buttons: ${JSON.stringify(buttons)}`);
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'interactive', success: true }).catch(() => {});
    }
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
        buttons: buttons.slice(0, 3).map(btn => ({
          type: 'reply',
          reply: { id: btn.id, title: btn.title.substring(0, 20) }
        }))
      }
    }
  };

  try {
    await axios.post(
      `${WHATSAPP_API_BASE}/${phoneNumberId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    logger.info(`WhatsApp reply buttons sent to ${to}`);
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'interactive', success: true }).catch(() => {});
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('WhatsApp API error (reply buttons)', {
        status: error.response?.status,
        data: error.response?.data,
      });
    } else {
      logger.error('Failed to send WhatsApp reply buttons', error);
    }
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'interactive', success: false }).catch(() => {});
    }
  }
}

/**
 * Send WhatsApp location request message
 * Shows a message with "Send location" CTA button
 */
export async function sendLocationRequest(
  to: string,
  body: string,
  businessId?: string
): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    logger.info(`[WhatsApp Mock] Location Request to: ${to}`);
    logger.info(`[WhatsApp Mock] Body: ${body}`);
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'location', success: true }).catch(() => {});
    }
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
        name: 'send_location'
      }
    }
  };

  try {
    await axios.post(
      `${WHATSAPP_API_BASE}/${phoneNumberId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    logger.info(`WhatsApp location request sent to ${to}`);
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'location', success: true }).catch(() => {});
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('WhatsApp API error (location request)', {
        status: error.response?.status,
        data: error.response?.data,
      });
    } else {
      logger.error('Failed to send WhatsApp location request', error);
    }
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'location', success: false }).catch(() => {});
    }
  }
}

/**
 * Send WhatsApp document message (PDF, etc.)
 */
export async function sendDocument(
  to: string,
  documentUrl: string,
  filename: string,
  caption?: string,
  businessId?: string
): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    logger.info(`[WhatsApp Mock] Document to: ${to}`);
    logger.info(`[WhatsApp Mock] URL: ${documentUrl}`);
    logger.info(`[WhatsApp Mock] Filename: ${filename}`);
    if (caption) logger.info(`[WhatsApp Mock] Caption: ${caption}`);
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'document', success: true }).catch(() => {});
    }
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
    await axios.post(
      `${WHATSAPP_API_BASE}/${phoneNumberId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    logger.info(`WhatsApp document sent to ${to}: ${filename}`);
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'document', success: true }).catch(() => {});
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('WhatsApp API error (document)', {
        status: error.response?.status,
        data: error.response?.data,
      });
    } else {
      logger.error('Failed to send WhatsApp document', error);
    }
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'document', success: false }).catch(() => {});
    }
  }
}

/**
 * Send WhatsApp image message
 */
export async function sendImage(
  to: string,
  imageUrl: string,
  caption?: string,
  businessId?: string
): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    logger.info(`[WhatsApp Mock] Image to: ${to}`);
    logger.info(`[WhatsApp Mock] URL: ${imageUrl}`);
    if (caption) logger.info(`[WhatsApp Mock] Caption: ${caption}`);
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'image', success: true }).catch(() => {});
    }
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
    await axios.post(
      `${WHATSAPP_API_BASE}/${phoneNumberId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    logger.info(`WhatsApp image sent to ${to}`);
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'image', success: true }).catch(() => {});
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('WhatsApp API error (image)', {
        status: error.response?.status,
        data: error.response?.data,
      });
    } else {
      logger.error('Failed to send WhatsApp image', error);
    }
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'image', success: false }).catch(() => {});
    }
  }
}

/**
 * Send WhatsApp interactive list message
 */
export async function sendInteractiveListMessage(
  to: string,
  header: string,
  body: string,
  buttonText: string,
  sections: { title: string; rows: { id: string; title: string; description?: string }[] }[],
  businessId?: string
): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    logger.info(`[WhatsApp Mock] Interactive List to: ${to}`);
    logger.info(`[WhatsApp Mock] Header: ${header}, Body: ${body}`);
    logger.info(`[WhatsApp Mock] Sections: ${JSON.stringify(sections)}`);
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'interactive', success: true }).catch(() => {});
    }
    return;
  }

  // Build rows with optional description (WhatsApp rejects undefined values)
  const buildRow = (row: { id: string; title: string; description?: string }) => {
    const result: { id: string; title: string; description?: string } = {
      id: row.id,
      title: (row.title || 'Item').substring(0, 24), // Max 24 chars
    };
    if (row.description && row.description.trim()) {
      result.description = row.description.substring(0, 72); // Max 72 chars
    }
    return result;
  };

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: header.substring(0, 60) }, // Max 60 chars
      body: { text: body.substring(0, 1024) }, // Max 1024 chars
      action: {
        button: buttonText.substring(0, 20), // Max 20 chars
        sections: sections.map(section => ({
          title: (section.title || 'Menu').substring(0, 24), // Max 24 chars
          rows: section.rows.slice(0, 10).map(buildRow) // Max 10 rows per section
        }))
      }
    }
  };

  logger.debug('Interactive list payload:', JSON.stringify(payload.interactive.action, null, 2));

  try {
    await axios.post(
      `${WHATSAPP_API_BASE}/${phoneNumberId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    logger.info(`WhatsApp interactive list sent to ${to}`);
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'interactive', success: true }).catch(() => {});
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('WhatsApp API error (interactive list)', {
        status: error.response?.status,
        data: error.response?.data,
      });
    } else {
      logger.error('Failed to send WhatsApp interactive list', error);
    }
    if (businessId) {
      trackWhatsAppUsage({ businessId, direction: 'outbound', messageType: 'interactive', success: false }).catch(() => {});
    }
  }
}

/**
 * Track inbound WhatsApp message (called from webhook)
 */
export async function trackInboundMessage(
  businessId: string,
  messageType: MessageType = 'text'
): Promise<void> {
  trackWhatsAppUsage({
    businessId,
    direction: 'inbound',
    messageType,
    success: true,
  }).catch(() => {});
}
