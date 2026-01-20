/**
 * WhatsApp Web.js Message Handler
 * Handles incoming messages from whatsapp-web.js client
 * Uses shared processMessage logic from webhookController
 *
 * ANTI-BAN FEATURES:
 * - Human-like typing delays
 * - Rate limiting per user
 * - Natural response timing
 */

import { Message } from 'whatsapp-web.js';
import { logger } from '../utils/logger';
import { normalizePhoneNumber } from '../services/whatsapp/common';
import { getBusinessByPhone } from '../services/menuService';
import { findOrCreateCustomer } from '../services/customerService';
import {
  findOrCreateSession,
  getSessionWithItems,
} from '../services/sessionService';
import {
  saveIncomingMessage,
  saveOutgoingMessage,
} from '../services/messageService';
import { notifyBusinessAdmin } from '../services/notificationService';
import { updateSessionDeliveryInfo } from '../services/fulfillmentService';
import { generateOrderSummary } from '../services/orderService';
import {
  isValidPhoneNumber,
  sanitizePhoneNumber,
  isValidMessage,
  sanitizeMessage,
} from '../utils/validators';

// Anti-spam utilities for human-like behavior
import {
  sendHumanLikeReply,
  canSendMessage,
  getRateLimitStats,
} from '../services/whatsapp/antiSpam';

// Import processMessage from the main controller
// This is the shared AI processing logic
import { processMessageForWebJS } from './webhookController';

/**
 * Handle incoming message from whatsapp-web.js
 * This is registered as the message handler in webjsClient
 */
export async function handleWebjsMessage(message: Message): Promise<void> {
  try {
    // Skip status broadcasts and our own messages
    if (message.isStatus || message.fromMe) {
      return;
    }

    // Extract phone numbers
    const fromPhone = normalizePhoneNumber(message.from);
    const toPhone = normalizePhoneNumber(message.to);

    logger.info(`[WebJS] Message from ${fromPhone} to ${toPhone}`);

    // Look up business by the receiving phone number
    const business = await getBusinessByPhone(toPhone);
    if (!business) {
      logger.warn(`[WebJS] Business not found for phone: ${toPhone}`);
      // Try with the 'from' number in case of group messages or other scenarios
      return;
    }

    logger.info(`[WebJS] Message for business: ${business.name}`);

    const businessTimezone = business.timezone || 'Asia/Kolkata';

    // Handle different message types
    const messageType = message.type;

    // Handle location messages
    if (messageType === 'location' && message.location) {
      await handleLocationMessage(message, fromPhone, business, businessTimezone);
      return;
    }

    // Handle media messages (voice/audio)
    if (message.hasMedia && (messageType === 'ptt' || messageType === 'audio')) {
      await handleVoiceMessage(message, fromPhone, business);
      return;
    }

    // Handle image messages
    if (message.hasMedia && messageType === 'image') {
      await handleImageMessage(message, fromPhone, business);
      return;
    }

    // Handle sticker messages - save for admin visibility, no AI processing
    if (message.hasMedia && messageType === 'sticker') {
      await handleStickerMessage(message, fromPhone, business);
      return;
    }

    // Handle text messages
    if (messageType === 'chat' && message.body) {
      await handleTextMessage(message, fromPhone, business);
      return;
    }

    logger.debug(`[WebJS] Skipping unsupported message type: ${messageType}`);
  } catch (error) {
    logger.error('[WebJS] Error handling message:', error);
  }
}

/**
 * Handle text message with anti-ban protection
 */
async function handleTextMessage(
  message: Message,
  fromPhone: string,
  business: { id: string; name: string; customer_support_phone?: string | null }
): Promise<void> {
  const sanitizedPhone = sanitizePhoneNumber(fromPhone);
  const sanitizedMessage = sanitizeMessage(message.body);

  if (!isValidPhoneNumber(sanitizedPhone)) {
    logger.warn(`[WebJS] Invalid phone number: ${fromPhone}`);
    return;
  }

  if (!isValidMessage(sanitizedMessage)) {
    logger.warn('[WebJS] Empty message received');
    return;
  }

  // Check rate limit before processing
  const rateCheck = canSendMessage(sanitizedPhone);
  if (!rateCheck.allowed) {
    logger.warn(`[WebJS] Rate limited for ${sanitizedPhone}: ${rateCheck.reason}`);
    // Silently skip - don't send error to avoid spam
    return;
  }

  try {
    // Process message using shared logic
    const reply = await processMessageForWebJS(sanitizedPhone, sanitizedMessage, business.id);

    if (reply) {
      // Send with human-like delays (typing indicator + natural timing)
      const sent = await sendHumanLikeReply(message, reply, sanitizedPhone);
      if (!sent) {
        logger.warn(`[WebJS] Failed to send reply to ${sanitizedPhone} (rate limited)`);
      }
    }
  } catch (error) {
    logger.error('[WebJS] Error processing message:', error);

    const supportPhone = business.customer_support_phone;
    let errorMsg = "We're experiencing a temporary issue. Please try again in a moment.";
    if (supportPhone) {
      errorMsg += `\n\n📞 Need immediate help? Contact us: ${supportPhone}`;
    }
    errorMsg += "\n\n_Tip: You can continue by telling us what you'd like to order._";

    // Even error messages should be human-like
    await sendHumanLikeReply(message, errorMsg, sanitizedPhone);
  }
}

/**
 * Handle location message with anti-ban protection
 */
async function handleLocationMessage(
  message: Message,
  fromPhone: string,
  business: { id: string; name: string; timezone?: string | null },
  businessTimezone: string
): Promise<void> {
  const location = message.location;
  if (!location) return;

  const sanitizedPhone = sanitizePhoneNumber(fromPhone);

  logger.info(`[WebJS] Location from ${fromPhone}: ${location.latitude}, ${location.longitude}`);

  const customer = await findOrCreateCustomer(fromPhone, business.id);
  const {session} = await findOrCreateSession(customer.id, business.id);
  const sessionWithItems = await getSessionWithItems(session.id);

  const displayAddress = location.description || 'Pinned Location 📍';
  await saveIncomingMessage(session.id, `[Location: ${location.latitude}, ${location.longitude}]`);

  // If customer is in delivery flow
  if (sessionWithItems?.fulfillment_type === 'delivery' && !sessionWithItems.delivery_address) {
    await updateSessionDeliveryInfo(session.id, {
      address: displayAddress,
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
    });

    if (!sessionWithItems.delivery_time) {
      const datePrompt = `📍 Location saved!\n\nWhen would you like delivery?\n\n1️⃣ *Today*\n2️⃣ *Tomorrow*\n3️⃣ *Other*\n\n_Reply with 1, 2, or 3_`;
      await saveOutgoingMessage(session.id, datePrompt);
      await sendHumanLikeReply(message, datePrompt, sanitizedPhone);
    } else {
      const locationSummary = await generateOrderSummary(session.id, {
        includeCta: true,
        ctaMessage: '\n📍 Location saved! Reply *YES* to confirm your order.',
        timezone: businessTimezone,
      });
      await sendHumanLikeReply(message, locationSummary, sanitizedPhone);
      await saveOutgoingMessage(session.id, locationSummary);
    }
  } else {
    const locationReply = "Thanks for sharing your location! 📍 We've saved it for your delivery.";
    await sendHumanLikeReply(message, locationReply, sanitizedPhone);
    await saveOutgoingMessage(session.id, locationReply);
  }
}

/**
 * Handle voice/audio message with anti-ban protection
 */
async function handleVoiceMessage(
  message: Message,
  fromPhone: string,
  business: { id: string; name: string; customer_support_phone?: string | null }
): Promise<void> {
  const sanitizedPhone = sanitizePhoneNumber(fromPhone);

  logger.info(`[WebJS] Voice message from ${fromPhone}`);

  const customer = await findOrCreateCustomer(fromPhone, business.id);
  const {session} = await findOrCreateSession(customer.id, business.id);

  await saveIncomingMessage(session.id, '[Voice message received]');

  // For now, voice transcription is not implemented for webjs
  // Could integrate with speech service later
  const voiceReply =
    "I received your voice message! 🎤\n\nVoice processing isn't available right now. Could you please type your message instead? 😊";

  await sendHumanLikeReply(message, voiceReply, sanitizedPhone);
  await saveOutgoingMessage(session.id, voiceReply);
}

/**
 * Handle image message with anti-ban protection
 */
async function handleImageMessage(
  message: Message,
  fromPhone: string,
  business: { id: string; name: string; customer_support_phone?: string | null }
): Promise<void> {
  const sanitizedPhone = sanitizePhoneNumber(fromPhone);

  logger.info(`[WebJS] Image from ${fromPhone}`);

  const customer = await findOrCreateCustomer(fromPhone, business.id);
  const {session} = await findOrCreateSession(customer.id, business.id);

  const caption = message.body || 'No caption';
  await saveIncomingMessage(session.id, `[Image: ${caption}]`);

  // Notify business admin
  await notifyBusinessAdmin(business.id, {
    type: 'customer_image',
    customerId: customer.id,
    phone: fromPhone,
    message: `Customer sent image${caption !== 'No caption' ? ': ' + caption : ''}`,
  });

  const supportPhone = business.customer_support_phone;
  let imageResponse = `I see you've sent an image! 📸\n\nSince I can't view images yet, I've notified our team to check it. They'll respond shortly!`;
  if (supportPhone) {
    imageResponse += `\n\n📞 Need immediate help? Contact: ${supportPhone}`;
  }
  imageResponse += `\n\nIn the meantime, you can describe what you'd like to order? 😊`;

  await sendHumanLikeReply(message, imageResponse, sanitizedPhone);
  await saveOutgoingMessage(session.id, imageResponse);
}

/**
 * Handle sticker message - save for admin visibility, no AI processing
 */
async function handleStickerMessage(
  message: Message,
  fromPhone: string,
  business: { id: string; name: string; customer_support_phone?: string | null }
): Promise<void> {
  logger.info(`[WebJS] Sticker from ${fromPhone}`);

  const customer = await findOrCreateCustomer(fromPhone, business.id);
  const {session} = await findOrCreateSession(customer.id, business.id);

  // Save sticker as a message for admin to see
  await saveIncomingMessage(session.id, '[Sticker]');

  // No automated response for stickers - just save for admin visibility
  logger.debug(`[WebJS] Sticker saved for session ${session.id}`);
}

/**
 * Get current rate limit statistics (for monitoring/debugging)
 */
export function getWebjsRateLimitStats() {
  return getRateLimitStats();
}
