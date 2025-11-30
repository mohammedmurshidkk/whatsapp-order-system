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
