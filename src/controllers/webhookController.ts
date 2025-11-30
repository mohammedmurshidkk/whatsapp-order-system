import { Request, Response } from 'express';
import { WhatsAppWebhookBody, TestMessageRequest, SessionItem } from '../types';
import { findOrCreateCustomer } from '../services/customerService';
import {
  findOrCreateSession,
  updateSessionActivity,
  getSessionWithItems,
  isAIPaused,
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
  formatMenuForCustomer,
} from '../services/menuService';
import {
  sendWhatsAppMessage,
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
// TODO: Change this to your actual business ID from Supabase
const DEFAULT_BUSINESS_ID = 'c3150207-4bf9-4ce4-8478-2e6369c46749';

// Format session items as strings for AI context
function formatSessionItemsForAI(items: SessionItem[]): string[] {
  return items.map((item) => {
    let desc = `${item.item_name}`;
    if (item.size_or_weight) desc += ` (${item.size_or_weight})`;
    if (item.quantity > 1) desc += ` x${item.quantity}`;
    if (item.custom_text) desc += ` - "${item.custom_text}"`;
    if (item.delivery_date) desc += ` - ${item.delivery_date}`;
    if (item.notes) desc += ` [${item.notes}]`;
    return desc;
  });
}

// Check if item already exists in session (to prevent duplicates)
function isItemDuplicate(
  existingItems: SessionItem[],
  newItemName: string,
  newItemSize?: string
): boolean {
  const normalizedNew = newItemName.toLowerCase().trim();

  return existingItems.some((item) => {
    const normalizedExisting = item.item_name.toLowerCase().trim();
    const sameItem =
      normalizedExisting === normalizedNew ||
      normalizedExisting.includes(normalizedNew) ||
      normalizedNew.includes(normalizedExisting);

    // If same item name, check if size also matches
    if (sameItem && newItemSize && item.size_or_weight) {
      return (
        item.size_or_weight.toLowerCase() === newItemSize.toLowerCase()
      );
    }

    return sameItem;
  });
}

async function processMessage(
  phone: string,
  messageText: string,
  businessId: string = DEFAULT_BUSINESS_ID
): Promise<string | null> {
  logger.info(`Processing message from ${phone}: ${messageText.substring(0, 50)}...`);

  // Get business context
  const business = await getBusinessById(businessId);
  logger.info(`Business: ${business?.name || 'NOT FOUND'} (ID: ${businessId})`);

  // Find or create customer
  const customer = await findOrCreateCustomer(phone);

  // Find or create active session
  const session = await findOrCreateSession(customer.id);

  // Update session activity
  await updateSessionActivity(session.id);

  // Check if AI is paused (human takeover mode)
  const aiPaused = await isAIPaused(session.id);
  if (aiPaused) {
    logger.info(`AI paused for session ${session.id}, skipping AI response`);
    // Still save the incoming message for record
    await saveIncomingMessage(session.id, messageText);
    return null; // Return null to indicate no AI response
  }

  // Get session with items (for duplicate prevention)
  const sessionWithItems = await getSessionWithItems(session.id);
  const existingItems = sessionWithItems?.items || [];

  // Get recent message history
  const messageHistory = await getRecentMessages(session.id);

  // Get menu for AI context
  let menuItems;
  let menuCategories;
  if (businessId) {
    menuItems = await getMenuItems(businessId);
    menuCategories = await getMenuCategories(businessId);
    logger.info(`Menu loaded: ${menuItems?.length || 0} items, ${menuCategories?.length || 0} categories`);
  } else {
    logger.warn('No business found - AI will have no menu context!');
  }

  // Build AI context
  const aiContext = {
    business: business || undefined,
    menuItems,
    menuCategories,
    currentSessionItems: formatSessionItemsForAI(existingItems),
  };

  // Process with AI
  const aiResponse = await processMessageWithAI(
    messageText,
    messageHistory,
    session,
    aiContext
  );

  // Save incoming message
  await saveIncomingMessage(session.id, messageText);

  let replyMessage = aiResponse.reply;

  // Handle different intents
  switch (aiResponse.intent) {
    case 'add_item':
      if (aiResponse.item && aiResponse.item.name) {
        // Check for duplicates before adding
        const isDuplicate = isItemDuplicate(
          existingItems,
          aiResponse.item.name,
          aiResponse.item.size_or_weight
        );

        if (isDuplicate) {
          logger.info(`Duplicate item prevented: ${aiResponse.item.name}`);
          // Don't add, but keep the AI's response (it should acknowledge it's already added)
        } else {
          await saveOrderItem(session.id, aiResponse.item, businessId);
          logger.info(`Item added: ${aiResponse.item.name}`);
        }
      }
      break;

    case 'modify_order':
      // Customer wants to modify their order (change quantity, remove item)
      if (aiResponse.item && aiResponse.item.name) {
        if (aiResponse.item.quantity === 0) {
          // Remove item
          await removeSessionItem(session.id, aiResponse.item.name, aiResponse.item.size_or_weight);
          logger.info(`Item removed: ${aiResponse.item.name}`);
        } else {
          // Check if item exists in session
          const itemExists = existingItems.some(item =>
            item.item_name.toLowerCase().includes(aiResponse.item!.name.toLowerCase()) ||
            aiResponse.item!.name.toLowerCase().includes(item.item_name.toLowerCase())
          );

          if (itemExists) {
            // Update quantity
            await updateSessionItemQuantity(
              session.id,
              aiResponse.item.name,
              aiResponse.item.quantity,
              aiResponse.item.size_or_weight
            );
            logger.info(`Item updated: ${aiResponse.item.name} x${aiResponse.item.quantity}`);
          } else {
            // Add as new item
            await saveOrderItem(session.id, aiResponse.item, businessId);
            logger.info(`Item added: ${aiResponse.item.name}`);
          }
        }
      }
      // Always show updated summary after modification
      const modifiedSummary = await generateOrderSummary(session.id);
      replyMessage = aiResponse.reply + '\n\n' + modifiedSummary;
      break;

    case 'show_menu':
      // Send formatted menu to customer
      if (menuItems && menuCategories && menuItems.length > 0) {
        replyMessage = formatMenuForCustomer(menuItems, menuCategories);
      } else {
        replyMessage =
          "We have cakes, coffee, tea, cold drinks, and snacks! Just tell me what you'd like.";
      }
      break;

    case 'ready_for_checkout':
      // Generate and send order summary
      const summary = await generateOrderSummary(session.id);
      replyMessage = summary;
      break;

    case 'confirm_order':
      try {
        const order = await createFinalOrder(session.id);
        replyMessage = `✅ Order confirmed!\n\nOrder ID: ${order.id.substring(0, 8)}\n\nThank you so much for your order! We'll have everything ready for you. Have a wonderful day! 🙏`;
      } catch (error) {
        logger.error('Failed to create order', error);
        replyMessage =
          "I'm sorry, I couldn't process your order right now. Please try again or contact us directly.";
      }
      break;

    case 'cancel':
      replyMessage =
        "No problem! Your order has been cancelled. Feel free to start a new order whenever you're ready!";
      break;

    case 'cancel_existing_order':
      if (aiResponse.order_id) {
        const cancelResult = await cancelOrderById(aiResponse.order_id, customer.id);
        if (cancelResult.success) {
          replyMessage = `✅ ${cancelResult.message}\n\nIf you'd like to place a new order, just let me know!`;
        } else {
          replyMessage = `❌ ${cancelResult.message}`;
        }
      } else {
        replyMessage = "Could you please provide the order ID? It's the 8-character code you received when you placed the order (e.g., 424bfda9).";
      }
      break;

    case 'conversation_ended':
      // Just send the farewell message, no need to ask more questions
      // The AI's reply should already be a proper goodbye
      break;

    case 'ask_question':
    case 'smalltalk':
    default:
      // Use AI's reply as is
      break;
  }

  // Save outgoing message
  await saveOutgoingMessage(session.id, replyMessage);

  logger.info(`Reply sent: ${replyMessage.substring(0, 50)}...`);

  return replyMessage;
}

export async function handleWhatsAppWebhook(
  req: Request,
  res: Response
): Promise<void> {
  // Immediately respond with 200 OK (WhatsApp requires fast response)
  res.status(200).send('OK');

  try {
    const signature = req.headers['x-hub-signature-256'] as string;
    const rawBody = JSON.stringify(req.body);

    // Verify signature (optional for MVP)
    if (signature && !verifyWebhookSignature(signature, rawBody)) {
      logger.warn('Invalid webhook signature');
      return;
    }

    const body = req.body as WhatsAppWebhookBody;

    // Check if this is a valid WhatsApp message
    if (body.object !== 'whatsapp_business_account') {
      return;
    }

    // Process each entry
    for (const entry of body.entry) {
      for (const change of entry.changes) {
        const value = change.value;

        // Skip if no messages
        if (!value.messages || value.messages.length === 0) {
          continue;
        }

        for (const message of value.messages) {
          // Only handle text messages for MVP
          if (message.type !== 'text' || !message.text?.body) {
            logger.debug(`Skipping non-text message type: ${message.type}`);
            continue;
          }

          const phone = sanitizePhoneNumber(message.from);
          const messageText = sanitizeMessage(message.text.body);

          if (!isValidPhoneNumber(phone)) {
            logger.warn(`Invalid phone number: ${message.from}`);
            continue;
          }

          if (!isValidMessage(messageText)) {
            logger.warn('Empty message received');
            continue;
          }

          try {
            // Use DEFAULT_BUSINESS_ID directly (will be dynamic in SaaS version)
            const reply = await processMessage(phone, messageText, DEFAULT_BUSINESS_ID);
            // Only send message if AI is not paused (reply will be null if paused)
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
    logger.debug('Test message endpoint called');
    const { phone, message } = req.body as TestMessageRequest;

    if (!phone || !message) {
      res.status(400).json({ error: 'Phone and message are required' });
      return;
    }

    const sanitizedPhone = sanitizePhoneNumber(phone);
    const sanitizedMessage = sanitizeMessage(message);

    if (!isValidPhoneNumber(sanitizedPhone)) {
      res.status(400).json({ error: 'Invalid phone number' });
      return;
    }

    if (!isValidMessage(sanitizedMessage)) {
      res.status(400).json({ error: 'Message cannot be empty' });
      return;
    }

    const reply = await processMessage(sanitizedPhone, sanitizedMessage);

    if (reply === null) {
      res.status(200).json({
        success: true,
        phone: sanitizedPhone,
        message: sanitizedMessage,
        reply: null,
        aiPaused: true,
        note: 'AI is paused for this session. Human takeover mode active.',
      });
      return;
    }

    res.status(200).json({
      success: true,
      phone: sanitizedPhone,
      message: sanitizedMessage,
      reply,
    });
  } catch (error) {
    logger.error('Test message error', error);
    res.status(500).json({
      error: 'Failed to process message',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
