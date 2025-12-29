/**
 * WhatsApp Web.js Provider
 * Uses whatsapp-web.js library for unofficial WhatsApp integration
 * Interactive messages (buttons/lists) are converted to text alternatives
 */

import { WhatsAppProvider, ReplyButton, ListSection, ProviderStatus } from './types';
import { getClient, isClientReady, getStatus as getClientStatus } from './webjsClient';
import {
  formatPhoneForWebJS,
  buttonsToText,
  listToText,
  locationRequestToText,
  logMessageSend,
  logMessageError,
  mockMessageSend,
} from './common';
import { logger } from '../../utils/logger';

/**
 * Send a text message via whatsapp-web.js
 */
export async function sendMessage(to: string, message: string): Promise<void> {
  const client = getClient();

  if (!client || !isClientReady()) {
    logger.warn('[WebJS] Client not ready, message not sent');
    mockMessageSend(to, message);
    return;
  }

  try {
    const chatId = formatPhoneForWebJS(to);
    await client.sendMessage(chatId, message);
    logMessageSend('WebJS', to, message);
  } catch (error) {
    logMessageError('WebJS', to, error);
  }
}

/**
 * Send reply buttons - converted to text format
 * whatsapp-web.js doesn't support native buttons
 */
export async function sendReplyButtons(
  to: string,
  body: string,
  buttons: ReplyButton[]
): Promise<void> {
  // Convert buttons to text format
  const textMessage = buttonsToText(body, buttons);
  await sendMessage(to, textMessage);
}

/**
 * Send interactive list - converted to text format
 * whatsapp-web.js doesn't support native lists
 */
export async function sendInteractiveList(
  to: string,
  header: string,
  body: string,
  _buttonText: string,
  sections: ListSection[]
): Promise<void> {
  // Convert list to text format
  const textMessage = listToText(header, body, sections);
  await sendMessage(to, textMessage);
}

/**
 * Send location request - converted to text format
 * whatsapp-web.js doesn't support location request buttons
 */
export async function sendLocationRequest(to: string, body: string): Promise<void> {
  // Convert to text with instructions
  const textMessage = locationRequestToText(body);
  await sendMessage(to, textMessage);
}

/**
 * Send document via whatsapp-web.js
 * Uses MessageMedia.fromUrl to fetch and send the document
 */
export async function sendDocument(
  to: string,
  documentUrl: string,
  filename: string,
  caption?: string
): Promise<void> {
  const client = getClient();

  if (!client || !isClientReady()) {
    logger.warn('[WebJS] Client not ready, document not sent');
    logger.info(`[WebJS Mock] Document to: ${to}`);
    logger.info(`[WebJS Mock] URL: ${documentUrl}`);
    logger.info(`[WebJS Mock] Filename: ${filename}`);
    return;
  }

  try {
    // Dynamic import to avoid loading whatsapp-web.js when not needed
    const { MessageMedia } = await import('whatsapp-web.js');
    const media = await MessageMedia.fromUrl(documentUrl, { unsafeMime: true });
    media.filename = filename;

    const chatId = formatPhoneForWebJS(to);
    await client.sendMessage(chatId, media, { caption });
    logMessageSend('WebJS', to, `[Document: ${filename}]`);
  } catch (error) {
    logMessageError('WebJS', to, error);
    // Fallback: send URL as text
    const fallbackMessage = caption
      ? `${caption}\n\nDownload: ${documentUrl}`
      : `Download menu: ${documentUrl}`;
    await sendMessage(to, fallbackMessage);
  }
}

/**
 * Get provider status
 */
export function getStatus(): ProviderStatus {
  return getClientStatus();
}

/**
 * Export as provider interface
 */
export const webjsProvider: WhatsAppProvider = {
  sendMessage,
  sendReplyButtons,
  sendInteractiveList,
  sendLocationRequest,
};
