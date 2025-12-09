import axios from 'axios';
import crypto from 'crypto';
import { WHATSAPP_API_VERSION } from '../config/constants';
import { logger } from '../utils/logger';

const WHATSAPP_API_BASE = `https://graph.facebook.com/${WHATSAPP_API_VERSION}`;

export async function sendWhatsAppMessage(
  to: string,
  message: string
): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  // For MVP: log to console instead of actual API call
  if (!phoneNumberId || !accessToken) {
    logger.info(`[WhatsApp Mock] To: ${to}`);
    logger.info(`[WhatsApp Mock] Message: ${message}`);
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
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('WhatsApp API error', {
        status: error.response?.status,
        data: error.response?.data,
      });
    } else {
      logger.error('Failed to send WhatsApp message', error);
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
  buttons: { id: string; title: string }[]
): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    logger.info(`[WhatsApp Mock] Reply Buttons to: ${to}`);
    logger.info(`[WhatsApp Mock] Body: ${body}`);
    logger.info(`[WhatsApp Mock] Buttons: ${JSON.stringify(buttons)}`);
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
          reply: { id: btn.id, title: btn.title.substring(0, 20) } // Max 20 chars
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
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('WhatsApp API error (reply buttons)', {
        status: error.response?.status,
        data: error.response?.data,
      });
    } else {
      logger.error('Failed to send WhatsApp reply buttons', error);
    }
  }
}

/**
 * Send WhatsApp location request message
 * Shows a message with "Send location" CTA button
 */
export async function sendLocationRequest(
  to: string,
  body: string
): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    logger.info(`[WhatsApp Mock] Location Request to: ${to}`);
    logger.info(`[WhatsApp Mock] Body: ${body}`);
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
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('WhatsApp API error (location request)', {
        status: error.response?.status,
        data: error.response?.data,
      });
    } else {
      logger.error('Failed to send WhatsApp location request', error);
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
  sections: { title: string; rows: { id: string; title: string; description?: string }[] }[]
): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    logger.info(`[WhatsApp Mock] Interactive List to: ${to}`);
    logger.info(`[WhatsApp Mock] Header: ${header}, Body: ${body}`);
    logger.info(`[WhatsApp Mock] Sections: ${JSON.stringify(sections)}`);
    return;
  }

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
          title: section.title.substring(0, 24), // Max 24 chars
          rows: section.rows.slice(0, 10).map(row => ({ // Max 10 rows per section
            id: row.id,
            title: row.title.substring(0, 24), // Max 24 chars
            description: row.description?.substring(0, 72) // Max 72 chars
          }))
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
    logger.info(`WhatsApp interactive list sent to ${to}`);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('WhatsApp API error (interactive list)', {
        status: error.response?.status,
        data: error.response?.data,
      });
    } else {
      logger.error('Failed to send WhatsApp interactive list', error);
    }
  }
}
