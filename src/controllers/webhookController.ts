import { Request, Response } from 'express';
import {
  WhatsAppWebhookBody,
  TestMessageRequest,
  SessionItem,
  Session,
  AIResponse,
  WhatsAppWebhookMessage,
} from '../types';
import { findOrCreateCustomer } from '../services/customerService';
import {
  findOrCreateSession,
  updateSessionActivity,
  getSessionWithItems,
  isAIPaused,
  updateSessionState,
  updateSessionFulfillment,
} from '../services/sessionService';
import {
  getRecentMessages,
  saveIncomingMessage,
  saveOutgoingMessage,
} from '../services/messageService';
import { processMessageWithAI } from '../services/aiService';
import {
  saveOrderItem,
  generateOrderSummary,
  createFinalOrder,
  updateSessionItemQuantity,
  removeSessionItem,
  cancelOrderById,
} from '../services/orderService';
import {
  getBusinessById,
  getMenuItems,
  getMenuCategories,
  formatMenuAsText, // Renamed
  buildMenuAsInteractiveList, // New
} from '../services/menuService';
import {
  sendWhatsAppMessage,
  sendInteractiveListMessage, // New
  verifyWebhookChallenge,
  verifyWebhookSignature,
} from '../services/whatsappService';
import {
  isValidPhoneNumber,
  sanitizePhoneNumber,
  isValidMessage,
  sanitizeMessage,
} from '../utils/validators';
import { logger } from '../utils/logger';

// Default business ID for MVP (will be dynamic in SaaS version)
const DEFAULT_BUSINESS_ID = 'c3150207-4bf9-4ce4-8478-2e6369c46749';

// Format session items as strings for AI context
function formatSessionItemsForAI(items: SessionItem[]): string[] {
  return items.map((item) => {
    let desc = `${item.item_name}`;
    if (item.size_or_weight) desc += ` (${item.size_or_weight})`;
    if (item.quantity > 1) desc += ` x${item.quantity}`;
    // Add-ons formatting can be added here if needed for AI context
    return desc;
  });
}

// Main message processing logic with state machine
async function processMessage(
  phone: string,
  messageText: string,
  businessId: string = DEFAULT_BUSINESS_ID
): Promise<string | null> {
  logger.info(
    `Processing message from ${phone}: "${messageText.substring(0, 50)}..."`
  );

  const customer = await findOrCreateCustomer(phone);
  const session = await findOrCreateSession(customer.id);
  await updateSessionActivity(session.id);

  if (await isAIPaused(session.id)) {
    logger.info(`AI paused for session ${session.id}, skipping AI response.`);
    await saveIncomingMessage(session.id, messageText);
    return null;
  }

  const fullSession = await getSessionWithItems(session.id);
  if (!fullSession) {
    throw new Error('Could not retrieve session details.');
  }

  const messageHistory = await getRecentMessages(session.id);
  const menuItems = await getMenuItems(businessId);
  const menuCategories = await getMenuCategories(businessId);

  const aiContext = {
    business: (await getBusinessById(businessId)) || undefined,
    menuItems: menuItems || [],
    menuCategories: menuCategories || [],
    currentSessionItems: formatSessionItemsForAI(fullSession.items),
    session: fullSession,
  };

  const aiResponse = await processMessageWithAI(
    messageText,
    messageHistory,
    fullSession,
    aiContext
  );

  await saveIncomingMessage(session.id, messageText);

  let replyMessage: string | null = aiResponse.reply;

  // STATE MACHINE
  switch (fullSession.session_state) {
    case 'ordering':
      replyMessage = await handleOrderingState(
        aiResponse,
        fullSession,
        businessId,
        phone
      );
      break;
    case 'awaiting_fulfillment_type':
      replyMessage = await handleFulfillmentTypeState(aiResponse, fullSession);
      break;
    case 'awaiting_delivery_details':
    case 'awaiting_takeaway_details':
      replyMessage = await handleFulfillmentDetailsState(
        aiResponse,
        fullSession
      );
      break;
    case 'awaiting_confirmation':
      replyMessage = await handleConfirmationState(aiResponse, fullSession);
      break;
    default:
      replyMessage =
        "I'm sorry, I seem to be a little lost. Could we start over?";
      await updateSessionState(fullSession.id, 'ordering');
  }

  // Only save outgoing message if one is being sent
  if (replyMessage) {
    await saveOutgoingMessage(session.id, replyMessage);
    logger.info(`Reply sent: ${replyMessage.substring(0, 50)}...`);
  }
  return replyMessage;
}

// Handles the 'ordering' state
async function handleOrderingState(
  aiResponse: AIResponse,
  session: Session,
  businessId: string,
  phone: string
): Promise<string | null> {
  let replyMessage: string | null = aiResponse.reply;
  const sessionId = session.id;

  switch (aiResponse.intent) {
    case 'add_item':
      if (aiResponse.item?.name) {
        await saveOrderItem(sessionId, aiResponse.item, businessId);
      }
      break;
    case 'modify_order':
      if (aiResponse.item?.name) {
        if (aiResponse.item.quantity === 0) {
          await removeSessionItem(
            sessionId,
            aiResponse.item.name,
            aiResponse.item.size_or_weight
          );
        } else {
          await updateSessionItemQuantity(
            sessionId,
            aiResponse.item.name,
            aiResponse.item.quantity,
            aiResponse.item.size_or_weight
          );
        }
      }
      const modifiedSummary = await generateOrderSummary(sessionId);
      replyMessage = aiResponse.reply + '\n\n' + modifiedSummary;
      break;
    case 'show_menu':
      const menuItems = await getMenuItems(businessId);
      const menuCategories = await getMenuCategories(businessId);
      if (menuItems && menuCategories && menuItems.length > 0) {
        // Send AI text reply first
        await sendWhatsAppMessage(phone, replyMessage);

        // Then send the interactive list
        const listPayload = buildMenuAsInteractiveList(
          menuItems,
          menuCategories
        );
        await sendInteractiveListMessage(phone, listPayload);

        // Return null because we've handled sending the messages
        return null;
      } else {
        replyMessage = 'Our menu is currently empty, please check back later!';
      }
      break;
    case 'ready_for_checkout':
      await updateSessionState(sessionId, 'awaiting_fulfillment_type');
      replyMessage =
        'Great! To finalize your order, I need a few more details.\n\nWill this be for *delivery* or *takeaway*?';
      break;
  }
  return replyMessage;
}

// Handles the 'awaiting_fulfillment_type' state
async function handleFulfillmentTypeState(
  aiResponse: AIResponse,
  session: Session
): Promise<string> {
  if (aiResponse.intent !== 'set_order_type' || !aiResponse.fulfillment?.type) {
    return "Sorry, I didn't catch that. Is it for delivery or takeaway?";
  }

  const type = aiResponse.fulfillment.type;
  await updateSessionFulfillment(session.id, { type });

  if (type === 'delivery') {
    await updateSessionState(session.id, 'awaiting_delivery_details');
    return 'Got it, delivery. What is the full address and preferred time for the delivery?';
  } else {
    // takeaway
    await updateSessionState(session.id, 'awaiting_takeaway_details');
    return 'Okay, takeaway. From which outlet and at what time would you like to pick up your order?';
  }
}

// Handles 'awaiting_delivery_details' and 'awaiting_takeaway_details' states
async function handleFulfillmentDetailsState(
  aiResponse: AIResponse,
  session: Session
): Promise<string> {
  if (
    aiResponse.intent !== 'provide_fulfillment_details' ||
    !aiResponse.fulfillment
  ) {
    return "Sorry, I didn't quite get those details. Could you provide them again?";
  }

  const { address, outlet, time } = aiResponse.fulfillment;
  const details = session.fulfillment_type === 'delivery' ? address : outlet;

  await updateSessionFulfillment(session.id, { details, time });
  await updateSessionState(session.id, 'awaiting_confirmation');

  const summary = await generateOrderSummary(session.id);
  return summary;
}

// Handles the 'awaiting_confirmation' state
async function handleConfirmationState(
  aiResponse: AIResponse,
  session: Session
): Promise<string> {
  if (aiResponse.intent === 'confirm_order') {
    try {
      const order = await createFinalOrder(session.id);
      return `✅ Order confirmed!\n\nYour Order ID is *${order.id.substring(
        0,
        8
      )}*.\n\nThank you for your order! We'll have everything ready for you. Have a wonderful day! 🙏`;
    } catch (error) {
      logger.error('Failed to create order', error);
      return "I'm sorry, I couldn't process your order right now. Please try again or contact us directly.";
    }
  } else if (
    aiResponse.intent === 'modify_order' ||
    aiResponse.intent === 'add_item'
  ) {
    await updateSessionState(session.id, 'ordering');
    return "No problem, let's make some changes. What would you like to update?";
  } else if (aiResponse.intent === 'cancel') {
    await updateSessionState(session.id, 'ordering'); // Reset state
    return "Your order has been cancelled. Feel free to start a new one whenever you're ready!";
  }

  return "I'm waiting for your confirmation. Please reply *YES* to confirm your order, or let me know if you want to make changes.";
}

export async function handleWhatsAppWebhook(
  req: Request,
  res: Response
): Promise<void> {
  res.status(200).send('OK');
  try {
    const body = req.body as WhatsAppWebhookBody;
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry) {
      for (const change of entry.changes) {
        if (!change.value.messages) continue;
        for (const message of change.value.messages) {
          const phone = sanitizePhoneNumber(message.from);
          if (!isValidPhoneNumber(phone)) {
            logger.warn(`Invalid phone number received: ${message.from}`);
            continue;
          }

          let messageText: string | null = null; // Initialize as nullable

          if (message.type === 'text' && message.text) {
            // Check if message.text exists
            messageText = sanitizeMessage(message.text.body);
          } else if (
            message.type === 'interactive' &&
            message.interactive?.type === 'list_reply' &&
            message.interactive.list_reply
          ) {
            // Safely access properties
            messageText = message.interactive.list_reply.id;
          } else {
            logger.debug(
              `Skipping message type: ${message.type} or unsupported interactive type`
            );
            continue; // Skip messages we don't handle
          }

          if (messageText === null || !isValidMessage(messageText)) {
            // Check messageText for null/validity
            logger.warn('Empty or invalid message content after parsing');
            continue;
          }

          try {
            // messageText is now guaranteed to be a string
            const reply = await processMessage(
              phone,
              messageText,
              DEFAULT_BUSINESS_ID
            );
            if (reply !== null) {
              await sendWhatsAppMessage(phone, reply);
            }
          } catch (error) {
            logger.error('Error processing message', error);
            await sendWhatsAppMessage(
              phone,
              "I'm sorry, something went wrong. Please try again in a moment."
            );
          }
        }
      }
    }
  } catch (error) {
    logger.error('Webhook processing error', error);
  }
}

export function handleWebhookVerification(req: Request, res: Response): void {
  logger.info('Webhook verification request received');
  logger.debug('Query params:', req.query);

  const mode = req.query['hub.mode'] as string;
  const token = req.query['hub.verify_token'] as string;
  const challenge = req.query['hub.challenge'] as string;

  logger.debug(`Mode: ${mode}, Token: ${token}, Challenge: ${challenge}`);

  const result = verifyWebhookChallenge(mode, token, challenge);

  if (result) {
    logger.info('Webhook verified successfully!');
    res.status(200).send(result);
  } else {
    res.status(403).send('Verification failed');
  }
}

export async function handleTestMessage(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { phone, message } = req.body as TestMessageRequest;

    if (!phone || !message) {
      res.status(400).json({ error: 'Phone and message are required' });
      return;
    }

    const sanitizedPhone = sanitizePhoneNumber(phone);
    const sanitizedMessage = sanitizeMessage(message);

    if (
      !isValidPhoneNumber(sanitizedPhone) ||
      !isValidMessage(sanitizedMessage)
    ) {
      res.status(400).json({ error: 'Invalid phone or message' });
      return;
    }

    const reply = await processMessage(sanitizedPhone, sanitizedMessage);

    if (reply === null) {
      res
        .status(200)
        .json({
          reply: null,
          note: 'AI is paused or message sent interactively.',
        });
      return;
    }

    res.status(200).json({ reply });
  } catch (error) {
    logger.error('Test message error', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
}
