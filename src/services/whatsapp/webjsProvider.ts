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
