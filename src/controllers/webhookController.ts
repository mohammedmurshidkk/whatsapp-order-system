import { Request, Response } from 'express';
import { WhatsAppWebhookBody, TestMessageRequest, SessionItem, MenuAddon } from '../types';
import { findOrCreateCustomer } from '../services/customerService';
import {
  findOrCreateSession,
  updateSessionActivity,
  getSessionWithItems,
  isAIPaused,
  updateSessionItemCustomText,
} from '../services/sessionService';
import {
  getRecentMessages,
  saveIncomingMessage,
  saveOutgoingMessage,
  saveIncomingMediaMessage,
} from '../services/messageService';
import { processIncomingMedia } from '../services/mediaService';
import { processMessageWithAI } from '../services/aiService';
import {
  normalizeManglish,
  containsMalayalamScript,
  isManglishMessage,
} from '../services/manglishService';
import {
  saveOrderItem,
  generateOrderSummary,
  createFinalOrder,
  updateSessionItemQuantity,
  removeSessionItem,
  cancelOrderById,
  getOrderStatus,
  getCustomerActiveOrder,
  getOrderStatusMessage,
} from '../services/orderService';
import {
  getBusinessById,
  getBusinessByPhone,
  getMenuItems,
  getMenuCategories,
  getMenuItemsByCategory,
  formatMenuForCustomer,
  buildCategoryListSections,
  buildCategoriesInGroup,
  buildItemListSections,
  buildSizeButtons,
  getCategoryById,
  getMenuItemById,
} from '../services/menuService';
import {
  getBusinessOutlets,
  formatOutletsForCustomer,
  findOutletByCustomerInput,
} from '../services/outletService';
import {
  updateSessionFulfillmentType,
  updateSessionDeliveryInfo,
  updateSessionPickupInfo,
  parseDeliveryTime,
  extractAddressAndTime,
  formatDeliveryTime,
  calculateDateTimeFromButtons,
} from '../services/fulfillmentService';
import {
  getAutoSuggestedAddons,
  addAddonToSessionItem,
  formatAddonsForCustomer,
  findAddonByCustomerInput,
  findMultipleAddonsByInput,
  removeAddonFromSession,
} from '../services/addonService';
import {
  sendWhatsAppMessage,
  verifyWebhookChallenge,
  verifyWebhookSignature,
  sendReplyButtons,
  sendInteractiveListMessage,
  sendLocationRequest,
  sendDocument,
} from '../services/whatsapp';
import { getMenuPdfUrl, menuPdfExists } from '../services/pdfService';
import { getAddressFromCoordinates } from '../services/geocodingService';
import {
  processVoiceMessage,
  isSpeechServiceAvailable,
  isVoiceEnabled,
} from '../services/speechService';
import { notifyBusinessAdmin } from '../services/notificationService';
import {
  isValidPhoneNumber,
  sanitizePhoneNumber,
  isValidMessage,
  sanitizeMessage,
} from '../utils/validators';
import { logger } from '../utils/logger';

// Track last added item per session for add-on attachment
const lastAddedItemMap = new Map<string, string>(); // sessionId -> itemId

// Track pending custom text questions per session
const pendingCustomTextMap = new Map<string, { itemId: string; prompt: string }>(); // sessionId -> { itemId, prompt }

// Track pending addon selections per session
const pendingAddonSelectionMap = new Map<string, { itemId: string; addons: MenuAddon[] }>(); // sessionId -> { itemId, addons }

// Track pending date selection for time button flow (date selected, waiting for time)
const pendingDateSelectionMap = new Map<string, { date: 'today' | 'tomorrow'; fulfillmentType: 'delivery' | 'takeaway' }>(); // sessionId -> { date, fulfillmentType }

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

/**
 * Core message processing logic - shared between Meta and WebJS handlers
 * Exported as processMessageForWebJS for use by webjsHandler
 */
export async function processMessage(
  phone: string,
  messageText: string,
  businessId: string
): Promise<string | null> {
  logger.info(`Processing message from ${phone}: ${messageText.substring(0, 50)}...`);

  // Normalize Manglish (Malayalam + English) to English for AI processing
  const originalMessage = messageText;
  const normalizedMessage = normalizeManglish(messageText);
  const wasManglishNormalized = originalMessage.toLowerCase() !== normalizedMessage;
  const hasMalayalamScript = containsMalayalamScript(originalMessage);
  const isManglish = isManglishMessage(originalMessage);

  if (wasManglishNormalized) {
    logger.info(`Manglish normalized: "${originalMessage}" → "${normalizedMessage}"`);
  }

  // Use normalized message for processing
  messageText = normalizedMessage;

  // Get business context
  const business = await getBusinessById(businessId);
  logger.info(`Business: ${business?.name || 'NOT FOUND'} (ID: ${businessId})`);

  // Get business timezone for date/time parsing and display
  const businessTimezone = business?.timezone || 'Asia/Kolkata';

  // CHECK CRITICAL MESSAGE - If enabled, bypass AI and send critical message
  if (business?.critical_message_enabled && business?.critical_message) {
    logger.info(`⚠️ Critical message enabled for ${business.name} - bypassing AI`);
    return business.critical_message;
  }

  // Find or create customer for this business
  const customer = await findOrCreateCustomer(phone, businessId);

  // Find or create active session for this business
  const session = await findOrCreateSession(customer.id, businessId);

  // Update session activity
  await updateSessionActivity(session.id);

  // Check for pending custom text question (e.g., "What to write on cake?")
  const pendingCustomText = pendingCustomTextMap.get(session.id);
  if (pendingCustomText) {
    const normalizedInput = messageText.toLowerCase().trim();

    // Check if user is trying to skip custom text or order something else
    const skipWords = ['no', 'skip', 'none', 'nothing', 'no thanks', 'nope'];
    const wantsToSkip = skipWords.some(s => normalizedInput === s) ||
      /\b(no|don'?t|dont)\b.*(writ|text|message)/i.test(normalizedInput) ||
      /\b(skip|nothing)\b/i.test(normalizedInput);
    const looksLikeNewOrder = normalizedInput.match(/\b(want|order|give|need|get|add)\b/i) &&
      !normalizedInput.match(/\b(write|message|text)\b/i); // "add candle" but not "add message"

    if (wantsToSkip) {
      logger.info(`Customer skipped custom text for item ${pendingCustomText.itemId}`);
      pendingCustomTextMap.delete(session.id);
      await saveIncomingMessage(session.id, messageText);

      // Check if there are pending addons to ask about (stored when custom text was first asked)
      const pendingAddonsAfterSkip = pendingAddonSelectionMap.get(session.id);
      if (pendingAddonsAfterSkip && pendingAddonsAfterSkip.itemId === pendingCustomText.itemId) {
        // Ask about addons now
        const addonsMessage = formatAddonsForCustomer(pendingAddonsAfterSkip.addons);
        const skipWithAddons = `No problem!\n\n${addonsMessage}`;
        await saveOutgoingMessage(session.id, skipWithAddons);
        return skipWithAddons;
      }

      const skipReply = "No problem! Anything else you'd like to order?";
      await saveOutgoingMessage(session.id, skipReply);
      return skipReply;
    }

    if (looksLikeNewOrder) {
      // User wants to order something else, clear pending and continue to AI
      logger.info(`Input "${messageText}" looks like a new order, clearing pending custom text`);
      pendingCustomTextMap.delete(session.id);
      // Fall through to AI processing
    } else {
      // Customer is responding to a custom text question
      // Use originalMessage to preserve case (messageText is lowercased by normalizeManglish)
      let cleanedText = originalMessage;
      cleanedText = cleanedText.replace(/^(write|message|text|cake message|on cake|write on cake)[:\s]*/i, '').trim();
      // Remove surrounding quotes if present
      cleanedText = cleanedText.replace(/^["'](.*)["']$/, '$1').trim();

      logger.info(`Saving custom text response for item ${pendingCustomText.itemId}: "${cleanedText}"`);
      await updateSessionItemCustomText(pendingCustomText.itemId, cleanedText);
      pendingCustomTextMap.delete(session.id);

      // Save incoming message
      await saveIncomingMessage(session.id, messageText);

      // Check if there are pending addons to ask about (stored when custom text was first asked)
      const pendingAddonsAfterText = pendingAddonSelectionMap.get(session.id);
      if (pendingAddonsAfterText && pendingAddonsAfterText.itemId === pendingCustomText.itemId) {
        // Ask about addons now
        const addonsMessage = formatAddonsForCustomer(pendingAddonsAfterText.addons);
        const confirmWithAddons = `Got it! "${cleanedText}" will be written on your cake.\n\n${addonsMessage}`;
        await saveOutgoingMessage(session.id, confirmWithAddons);
        return confirmWithAddons;
      }

      // No addons to ask about
      const confirmReply = `Got it! "${cleanedText}" will be added to your cake. Anything else you'd like to order?`;
      await saveOutgoingMessage(session.id, confirmReply);
      return confirmReply;
    }
  }

  // Check for pending addon selection (e.g., user replied "1" or "candle" after addon suggestion)
  const pendingAddon = pendingAddonSelectionMap.get(session.id);
  if (pendingAddon) {
    const normalizedInput = messageText.toLowerCase().trim();

    // Check if user wants to skip addons
    if (['no', 'no thanks', 'skip', 'none', 'nope', 'nothing'].some(s => normalizedInput === s || normalizedInput.startsWith(s + ' '))) {
      logger.info(`Customer declined addons for item ${pendingAddon.itemId}`);
      pendingAddonSelectionMap.delete(session.id);

      await saveIncomingMessage(session.id, messageText);
      const skipReply = "No problem! Anything else you'd like to order?";
      await saveOutgoingMessage(session.id, skipReply);
      return skipReply;
    }

    // Check if user wants to write custom text (e.g., "write Happy Birthday", "message on cake")
    const wantsCustomText = normalizedInput.match(/\b(write|message|text|cake message)\b/i);
    if (wantsCustomText) {
      logger.info(`Customer wants to add custom text while in addon selection: "${messageText}"`);
      // Extract the custom text if provided inline
      let customTextContent = messageText;
      customTextContent = customTextContent.replace(/^(write|message|text|cake message|on cake|write on cake)[:\s]*/i, '').trim();
      customTextContent = customTextContent.replace(/^["'](.*)["']$/, '$1').trim();

      if (customTextContent && customTextContent.length > 2) {
        // Save custom text directly
        await updateSessionItemCustomText(pendingAddon.itemId, customTextContent);
        logger.info(`Custom text saved during addon selection: "${customTextContent}"`);
        // Keep addon selection pending - user might still want addons
        await saveIncomingMessage(session.id, messageText);
        const addonNames = pendingAddon.addons.map((a, i) => `${i + 1}. ${a.name}`).join('\n');
        const customTextReply = `Got it! "${customTextContent}" will be written on your cake.\n\nWould you also like any add-ons?\n${addonNames}\n\nOr say "no thanks" to skip.`;
        await saveOutgoingMessage(session.id, customTextReply);
        return customTextReply;
      } else {
        // Ask for the custom text
        await saveIncomingMessage(session.id, messageText);
        const askTextReply = "Sure! What would you like written on the cake?";
        await saveOutgoingMessage(session.id, askTextReply);
        // Set pending custom text for next message
        pendingCustomTextMap.set(session.id, {
          itemId: pendingAddon.itemId,
          prompt: "What would you like written on the cake?",
        });
        return askTextReply;
      }
    }

    // Try to find addon(s) by number or name - supports multi-select ("1, 3" or "candle and balloon")
    const selectedAddons = findMultipleAddonsByInput(messageText, pendingAddon.addons);

    if (selectedAddons.length > 0) {
      // Add all selected addons to the item
      const addedNames: string[] = [];
      for (const addon of selectedAddons) {
        await addAddonToSessionItem(pendingAddon.itemId, addon.id, 1);
        const priceText = addon.price ? ` (₹${addon.price})` : ' (FREE)';
        addedNames.push(`${addon.name}${priceText}`);
        logger.info(`Addon added: ${addon.name} to item ${pendingAddon.itemId}`);
      }
      pendingAddonSelectionMap.delete(session.id);

      await saveIncomingMessage(session.id, messageText);
      const addonReply = selectedAddons.length === 1
        ? `Added ${addedNames[0]}! Would you like anything else?`
        : `Added ${addedNames.join(', ')}! Would you like anything else?`;
      await saveOutgoingMessage(session.id, addonReply);
      return addonReply;
    }

    // If input doesn't match any addon, check if user wants to order something else
    // Don't clear immediately - give them another chance
    const looksLikeNewOrder = normalizedInput.match(/\b(want|order|give|need|get)\b/i) ||
      normalizedInput.match(/\b(cake|coffee|burger|tea|juice)\b/i);

    if (looksLikeNewOrder) {
      // User is ordering something new, clear addon pending and continue to AI
      logger.info(`Input "${messageText}" looks like a new order, continuing to AI`);
      pendingAddonSelectionMap.delete(session.id);
    } else {
      // Give hint about addon selection
      logger.info(`Input "${messageText}" didn't match addons, giving hint`);
      await saveIncomingMessage(session.id, messageText);

      const addonNames = pendingAddon.addons.map((a, i) => `${i + 1}. ${a.name}`).join('\n');
      const hintReply = `I didn't catch that. Please reply with:\n${addonNames}\n\nOr say "no thanks" to skip add-ons.\n\n💡 _To add a cake message, say "write Happy Birthday" or similar._`;
      await saveOutgoingMessage(session.id, hintReply);
      return hintReply;
    }
  }

  // Check if session needs time (has fulfillment type but no time) and user typed a time-like message
  const sessionForTimeCheck = await getSessionWithItems(session.id);
  if (sessionForTimeCheck) {
    const needsDeliveryTime = sessionForTimeCheck.fulfillment_type === 'delivery' &&
      sessionForTimeCheck.delivery_address && !sessionForTimeCheck.delivery_time;
    const needsPickupTime = sessionForTimeCheck.fulfillment_type === 'takeaway' &&
      sessionForTimeCheck.pickup_outlet_id && !sessionForTimeCheck.pickup_time;

    if (needsDeliveryTime || needsPickupTime) {
      // Check if message looks like a time input
      const looksLikeTime = /\d{1,2}(?::\d{2})?\s*(?:am|pm)|morning|evening|afternoon|today|tomorrow|nale|innu/i.test(messageText);

      if (looksLikeTime) {
        logger.info(`Session needs time, parsing: "${messageText}"`);
        const parsedTime = parseDeliveryTime(messageText, businessTimezone);

        if (parsedTime) {
          await saveIncomingMessage(session.id, messageText);

          if (needsDeliveryTime) {
            await updateSessionDeliveryInfo(session.id, {
              address: sessionForTimeCheck.delivery_address!,
              time: parsedTime,
            });
            logger.info(`Delivery time saved: ${parsedTime}`);
          } else {
            await updateSessionPickupInfo(session.id, {
              outlet_id: sessionForTimeCheck.pickup_outlet_id!,
              time: parsedTime,
            });
            logger.info(`Pickup time saved: ${parsedTime}`);
          }

          // Show final invoice with confirmation prompt
          const finalSummary = await generateOrderSummary(session.id, {
            includeCta: true,
            ctaMessage: '\nPlease review your order. Reply *YES* to confirm.',
            timezone: businessTimezone,
          });
          await saveOutgoingMessage(session.id, finalSummary);
          return finalSummary;
        }
      }
    }
  }

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

  // Check if this is the first message in the session (for welcome message)
  const isFirstMessage = messageHistory.length === 0;

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

  // Get outlets for fulfillment
  const outlets = businessId ? await getBusinessOutlets(businessId) : [];
  logger.info(`Outlets loaded: ${outlets.length}`);

  // Build AI context - use sessionWithItems for LATEST fulfillment data
  const latestSessionData = sessionWithItems || session;
  const aiContext = {
    business: business || undefined,
    menuItems,
    menuCategories,
    currentSessionItems: formatSessionItemsForAI(existingItems),
    outlets,
    sessionHasFulfillmentType: !!latestSessionData.fulfillment_type,
    sessionHasDeliveryInfo: !!latestSessionData.delivery_address,
    sessionHasPickupInfo: !!latestSessionData.pickup_outlet_id,
  };

  logger.debug(`AI context fulfillment: type=${latestSessionData.fulfillment_type}, addr=${latestSessionData.delivery_address}, outlet=${latestSessionData.pickup_outlet_id}`);

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
  let intentToProcess = aiResponse.intent;

  // SERVER-SIDE: Detect custom text change requests (e.g., "change text to Happy Birthday")
  const customTextChangeMatch = messageText.match(/(?:change|update|make it|write)\s*(?:the\s*)?(?:text|message|writing)?\s*(?:to|into|as)?\s*["']?(.+?)["']?\s*$/i);
  if (customTextChangeMatch && existingItems.length > 0) {
    const newCustomText = customTextChangeMatch[1].replace(/^["']|["']$/g, '').trim();
    if (newCustomText.length > 2) {
      const lastItemId = lastAddedItemMap.get(session.id);
      if (lastItemId) {
        await updateSessionItemCustomText(lastItemId, newCustomText);
        logger.info(`Custom text updated via server-side detection: "${newCustomText}"`);
      }
    }
  }

  // SERVER-SIDE INTENT OVERRIDE: Handle "yes" confirmation robustly
  // This helps when AI model doesn't correctly identify confirm_order intent
  const isYesMessage = /^(yes|yeah|yep|yup|confirm|ok|okay|sure|go ahead)$/i.test(messageText.trim());
  if (isYesMessage && existingItems.length > 0) {
    // Check if fulfillment is complete - if so, this should be confirm_order
    if (latestSessionData.fulfillment_type &&
        (latestSessionData.delivery_address || latestSessionData.pickup_outlet_id)) {
      logger.info(`🔧 Override: User said YES with complete fulfillment - forcing confirm_order`);
      intentToProcess = 'confirm_order';
    }
    // If no fulfillment yet, let AI handle it naturally (will ask for delivery/takeaway)
  }

  // Handle different intents
  switch (intentToProcess) {
    case 'add_item':
      // Handle multiple items with individual notes (e.g., "2 burgers - one less spicy, one extra cheese")
      if (aiResponse.items && aiResponse.items.length > 0) {
        logger.info(`🛒 ADD_ITEM intent received for ${aiResponse.items.length} items with individual notes`);

        let lastSavedItemId: string | null = null;
        const addedItemNames: string[] = [];

        for (const itemData of aiResponse.items) {
          if (!itemData.name) continue;

          // Check for duplicates before adding
          const isDuplicate = isItemDuplicate(existingItems, itemData.name, itemData.size_or_weight);
          if (isDuplicate) {
            logger.info(`Duplicate item prevented: ${itemData.name}`);
            continue;
          }

          try {
            const savedItem = await saveOrderItem(session.id, {
              ...itemData,
              quantity: itemData.quantity || 1,
            }, businessId);
            logger.info(`✅ Item SAVED to DB: ${itemData.name} (ID: ${savedItem.id}, notes: ${itemData.notes || 'none'})`);
            lastSavedItemId = savedItem.id;

            const itemDesc = itemData.notes
              ? `${itemData.name}${itemData.size_or_weight ? ` (${itemData.size_or_weight})` : ''} - ${itemData.notes}`
              : `${itemData.name}${itemData.size_or_weight ? ` (${itemData.size_or_weight})` : ''}`;
            addedItemNames.push(itemDesc);
          } catch (saveError) {
            logger.error(`❌ Failed to save item to DB: ${itemData.name}`, saveError);
          }
        }

        if (lastSavedItemId) {
          lastAddedItemMap.set(session.id, lastSavedItemId);
        }

        if (addedItemNames.length > 0) {
          replyMessage = `Added to cart:\n${addedItemNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}\n\nAnything else?`;
        }
        break;
      }

      if (aiResponse.item && aiResponse.item.name) {
        logger.info(`🛒 ADD_ITEM intent received for: ${aiResponse.item.name} (size: ${aiResponse.item.size_or_weight || 'default'}, qty: ${aiResponse.item.quantity || 1}, notes: ${aiResponse.item.notes || 'none'})`);

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
          try {
            const savedItem = await saveOrderItem(session.id, aiResponse.item, businessId);
            logger.info(`✅ Item SAVED to DB: ${aiResponse.item.name} (ID: ${savedItem.id})`);

            // Store last added item ID for add-on attachment
            lastAddedItemMap.set(session.id, savedItem.id);

            // Check for custom text prompt OR add-ons (ask separately, custom text first)
            if (menuItems && menuItems.length > 0) {
              const addedMenuItem = menuItems.find(
                mi => mi.name.toLowerCase() === aiResponse.item!.name.toLowerCase()
              );

              if (addedMenuItem && addedMenuItem.category_id) {
                // Check for category note (display only) and custom text prompt (expects input)
                let hasCustomTextPrompt = false;
                let categoryNoteToShow = '';

                if (menuCategories && menuCategories.length > 0) {
                  const category = menuCategories.find(c => c.id === addedMenuItem.category_id);

                  // Display-only note (no input expected)
                  if (category?.category_note) {
                    categoryNoteToShow = category.category_note;
                    logger.info(`Category has display note: "${category.category_note}"`);
                  }

                  // Custom text prompt (expects input)
                  if (category?.custom_text_prompt) {
                    hasCustomTextPrompt = true;
                    logger.info(`Category has custom_text_prompt: "${category.custom_text_prompt}"`);
                    // Store pending custom text question for next message
                    pendingCustomTextMap.set(session.id, {
                      itemId: savedItem.id,
                      prompt: category.custom_text_prompt,
                    });
                    // Also store addons for AFTER custom text is collected
                    const suggestedAddons = await getAutoSuggestedAddons(addedMenuItem.category_id);
                    if (suggestedAddons.length > 0) {
                      pendingAddonSelectionMap.set(session.id, {
                        itemId: savedItem.id,
                        addons: suggestedAddons,
                      });
                    }
                    // REPLACE the AI reply - don't ask "Anything else?" when we need custom text
                    // Build a clean response that only asks for custom text input
                    const itemDesc = aiResponse.item?.size_or_weight
                      ? `${addedMenuItem.name} (${aiResponse.item.size_or_weight})`
                      : addedMenuItem.name;
                    const notePrefix = categoryNoteToShow ? `_${categoryNoteToShow}_\n\n` : '';
                    replyMessage = `Added ${itemDesc} to your cart! 🛒\n\n${notePrefix}${category.custom_text_prompt}`;
                  } else if (categoryNoteToShow) {
                    // Only display note (no input expected), continue with addons
                    replyMessage = aiResponse.reply + `\n\n_${categoryNoteToShow}_`;
                  }
                }

                // If no custom text prompt, check for add-ons directly
                if (!hasCustomTextPrompt) {
                  const suggestedAddons = await getAutoSuggestedAddons(addedMenuItem.category_id);
                  if (suggestedAddons.length > 0) {
                    logger.info(`${suggestedAddons.length} add-ons available for ${addedMenuItem.name}`);
                    const addonsMessage = formatAddonsForCustomer(suggestedAddons);
                    replyMessage = aiResponse.reply + '\n\n' + addonsMessage;

                    // Store pending addon selection for next message
                    pendingAddonSelectionMap.set(session.id, {
                      itemId: savedItem.id,
                      addons: suggestedAddons,
                    });
                  }
                }
              }
            }
          } catch (saveError) {
            logger.error(`❌ Failed to save item to DB: ${aiResponse.item.name}`, saveError);
            const supportPhone = business?.customer_support_phone;
            replyMessage = `We couldn't add that item to your cart. Please try again.${supportPhone ? `\n\n📞 Need help? Contact: ${supportPhone}` : ''}`;
          }
        }
      } else {
        logger.warn(`⚠️ ADD_ITEM intent but missing item data: ${JSON.stringify(aiResponse)}`);
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
      const modifiedSummary = await generateOrderSummary(session.id, {
        includeCta: true,
        ctaMessage: 'Reply *YES* to confirm these items.',
        timezone: businessTimezone
      });
      replyMessage = aiResponse.reply + '\n\n' + modifiedSummary;
      break;

    case 'suggest_addons':
      // AI is suggesting add-ons (already formatted in AI reply)
      // Just use the AI's reply as is
      logger.info('AI suggesting add-ons');
      break;

    case 'add_addon':
      // Customer wants to add an add-on
      if (aiResponse.addon && aiResponse.addon.addon_name) {
        const lastItemId = lastAddedItemMap.get(session.id);

        if (!lastItemId) {
          logger.warn('No last item found for add-on attachment');
          replyMessage = "I couldn't find the item to attach this add-on to. Please add an item first, then we can add extras to it.";
          break;
        }

        // Find the add-on from available add-ons (could be by name or number)
        if (menuItems && menuItems.length > 0) {
          // Get the last added item to find its category
          const lastItem = existingItems.find(item => item.id === lastItemId);
          if (lastItem) {
            const menuItem = menuItems.find(
              mi => mi.name.toLowerCase() === lastItem.item_name.toLowerCase()
            );

            if (menuItem && menuItem.category_id) {
              const availableAddons = await getAutoSuggestedAddons(menuItem.category_id);

              // Try to match addon by customer input (could be number or name)
              let selectedAddon = findAddonByCustomerInput(messageText, availableAddons);

              // If not found, try by AI-provided name
              if (!selectedAddon) {
                selectedAddon = availableAddons.find(
                  addon => addon.name.toLowerCase() === aiResponse.addon!.addon_name.toLowerCase()
                ) || null
              }

              if (selectedAddon) {
                await addAddonToSessionItem(lastItemId, selectedAddon.id, aiResponse.addon.quantity || 1);
                logger.info(`Add-on added: ${selectedAddon.name} to item ${lastItemId}`);

                // Update reply to confirm
                if (!replyMessage.includes('Added')) {
                  replyMessage = `Added ${selectedAddon.name}${selectedAddon.price ? ` (₹${selectedAddon.price})` : ' (FREE)'}! ${replyMessage}`;
                }
              } else {
                logger.warn(`Add-on not found: ${aiResponse.addon.addon_name}`);
                replyMessage = "That add-on isn't available. Would you like something else?";
              }
            }
          }
        }
      }
      break;

    case 'decline_addon':
      // Customer declined add-ons
      logger.info('Customer declined add-ons');
      // Just use AI's reply
      break;

    case 'remove_addon':
      // Customer wants to remove an add-on from their order
      if (aiResponse.addon && aiResponse.addon.addon_name) {
        const removeResult = await removeAddonFromSession(session.id, aiResponse.addon.addon_name);

        if (removeResult.success) {
          logger.info(`Add-on removed: ${removeResult.addonName} from ${removeResult.itemName}`);
          replyMessage = `✅ Removed ${removeResult.addonName} from your ${removeResult.itemName}. Anything else?`;

          // Clear pending addon selection if exists
          pendingAddonSelectionMap.delete(session.id);
        } else {
          logger.warn(`Failed to remove addon: ${aiResponse.addon.addon_name}`);
          replyMessage = `I couldn't find "${aiResponse.addon.addon_name}" in your order. Would you like me to show your current order?`;
        }
      } else {
        replyMessage = "Which add-on would you like to remove?";
      }
      break;

    case 'continue_ordering':
      // Ask for more items after add-ons handled
      logger.info('Continuing with ordering');
      // AI's reply should ask "Anything else?"
      break;

    case 'save_custom_text':
      // Save custom text response (e.g., cake message)
      // Try to extract text from AI response or from user message
      let customTextToSave = aiResponse.customText;

      // Fallback: Extract from user message if AI didn't provide it
      if (!customTextToSave) {
        // Pattern: "change text to X", "update message to X", "write X instead"
        const changeMatch = messageText.match(/(?:change|update|make it|write)\s*(?:the\s*)?(?:text|message|writing)?\s*(?:to|into|as)?\s*["']?(.+?)["']?\s*$/i);
        if (changeMatch) {
          customTextToSave = changeMatch[1].replace(/^["']|["']$/g, '').trim();
        }
      }

      if (customTextToSave) {
        const lastItemId = lastAddedItemMap.get(session.id);
        if (lastItemId) {
          await updateSessionItemCustomText(lastItemId, customTextToSave);
          logger.info(`Custom text saved: "${customTextToSave}" for item ${lastItemId}`);
          // Clear pending custom text if exists
          pendingCustomTextMap.delete(session.id);
        } else {
          logger.warn('No last item found for custom text');
        }
      }
      break;

    case 'modify_custom_text':
      // Customer wants to change the cake writing
      let newCustomText = aiResponse.customText;

      // Fallback: Extract from user message if AI didn't provide it
      if (!newCustomText) {
        const modifyMatch = messageText.match(/(?:change|update|make it|write)\s*(?:the\s*)?(?:text|message|writing)?\s*(?:to|into|as)?\s*["']?(.+?)["']?\s*$/i);
        if (modifyMatch) {
          newCustomText = modifyMatch[1].replace(/^["']|["']$/g, '').trim();
        }
      }

      // Helper function to find the target item for custom text
      const findTargetItemForCustomText = (): typeof existingItems[0] | null => {
        // 1. Check if AI provided item name
        if (aiResponse.item?.name) {
          const aiItemMatch = existingItems.find(item =>
            item.item_name.toLowerCase().includes(aiResponse.item!.name.toLowerCase()) ||
            aiResponse.item!.name.toLowerCase().includes(item.item_name.toLowerCase())
          );
          if (aiItemMatch) return aiItemMatch;
        }

        // 2. Try to extract item name from user message
        // Patterns: "on Black Forest", "on the Rainbow cake", "for chocolate cake"
        const itemNameMatch = messageText.match(/(?:on|for|to)\s*(?:the\s*)?["']?([a-zA-Z\s]+?)["']?\s*(?:cake)?$/i) ||
                              messageText.match(/["']?([a-zA-Z\s]+?)["']?\s*(?:cake)?\s*(?:text|message|writing)/i);

        if (itemNameMatch) {
          const mentionedItem = itemNameMatch[1].trim().toLowerCase();
          const matchedItem = existingItems.find(item =>
            item.item_name.toLowerCase().includes(mentionedItem) ||
            mentionedItem.includes(item.item_name.toLowerCase())
          );
          if (matchedItem) return matchedItem;
        }

        // 3. Check for item names mentioned anywhere in the message
        for (const item of existingItems) {
          if (messageText.toLowerCase().includes(item.item_name.toLowerCase())) {
            return item;
          }
        }

        // 4. Fallback: item with existing custom_text or last added item
        return existingItems.find(item => item.custom_text) || existingItems[existingItems.length - 1] || null;
      };

      // Filter items that could have custom text (typically cakes)
      const customizableItems = existingItems.filter(item => {
        const itemNameLower = item.item_name.toLowerCase();
        return itemNameLower.includes('cake') || itemNameLower.includes('pastry') ||
               itemNameLower.includes('cupcake') || item.custom_text;
      });

      if (newCustomText) {
        // Find the specific item to update
        let itemToUpdate = findTargetItemForCustomText();

        if (itemToUpdate) {
          await updateSessionItemCustomText(itemToUpdate.id, newCustomText);
          logger.info(`Custom text modified: "${newCustomText}" for item ${itemToUpdate.id} (${itemToUpdate.item_name})`);
          replyMessage = `Got it! Updated the message on your ${itemToUpdate.item_name} to "${newCustomText}". Anything else?`;
          // Clear pending custom text only after successfully updating
          pendingCustomTextMap.delete(session.id);
        } else {
          logger.warn('No item found to update custom text');
          replyMessage = "I couldn't find an item with text to update. Would you like to add something first?";
        }
      } else {
        // No custom text provided - need to SET pending state to wait for user's response

        // Check if multiple customizable items exist and user didn't specify which one
        if (customizableItems.length > 1) {
          // Check if user mentioned a specific item
          let itemToUpdate = findTargetItemForCustomText();
          const userMentionedSpecificItem = existingItems.some(item =>
            messageText.toLowerCase().includes(item.item_name.toLowerCase())
          );

          if (!userMentionedSpecificItem) {
            // Multiple cakes and user didn't specify - ask which one
            const cakeList = customizableItems.map((item, i) => `${i + 1}. ${item.item_name}`).join('\n');
            replyMessage = `You have multiple items. Which one would you like to add writing to?\n\n${cakeList}`;
            // Don't set pending yet - wait for them to specify which cake
            break;
          }

          // User mentioned specific item
          if (itemToUpdate) {
            pendingCustomTextMap.set(session.id, {
              itemId: itemToUpdate.id,
              prompt: `What would you like written on your ${itemToUpdate.item_name}?`,
            });
            replyMessage = `What would you like written on your ${itemToUpdate.item_name}?`;
          } else {
            replyMessage = "I couldn't find that item in your order. Which item would you like to add writing to?";
          }
        } else {
          // Single item or no ambiguity
          const itemToUpdate = findTargetItemForCustomText();
          if (itemToUpdate) {
            pendingCustomTextMap.set(session.id, {
              itemId: itemToUpdate.id,
              prompt: `What would you like written on your ${itemToUpdate.item_name}?`,
            });
            replyMessage = `What would you like written on your ${itemToUpdate.item_name}?`;
          } else {
            replyMessage = "I couldn't find an item to update. Would you like to add something first?";
          }
        }
      }
      break;

    case 'remove_custom_text':
      // Customer wants to remove the cake writing entirely
      const itemWithText = existingItems.find(item => item.custom_text);
      if (itemWithText) {
        await updateSessionItemCustomText(itemWithText.id, ''); // Clear the custom text
        logger.info(`Custom text removed for item ${itemWithText.id}`);
        replyMessage = `Done! I've removed the text from your ${itemWithText.item_name}. Anything else you'd like to change?`;
      } else {
        logger.warn('No item found with custom text to remove');
        replyMessage = "There's no text to remove from your order. Anything else I can help with?";
      }
      // Clear pending custom text if exists
      pendingCustomTextMap.delete(session.id);
      break;

    case 'show_menu':
      // Send PDF menu if available, otherwise fallback to interactive/text
      if (business?.id) {
        const pdfExists = await menuPdfExists(business.id);
        if (pdfExists) {
          const pdfUrl = getMenuPdfUrl(business.id);
          const menuCaption = `Here's our menu! Browse through and let me know what you'd like to order.`;
          await saveOutgoingMessage(session.id, `[Menu PDF sent] ${menuCaption}`);
          await sendDocument(
            phone,
            pdfUrl,
            `${business.name || 'Menu'}.pdf`,
            menuCaption
          );
          return null; // Don't send another message
        }
      }
      // Fallback: Send interactive category list for large menus, text for small menus
      if (menuItems && menuCategories && menuItems.length > 0) {
        if (menuItems.length > 30 && menuCategories.length > 5) {
          // Large menu: Use interactive list with smart groupings
          const categorySections = buildCategoryListSections(menuCategories);
          if (categorySections.length > 0) {
            const menuIntro = `Welcome to ${business?.name || 'our cafe'}! Tap below to browse our menu.`;
            await saveOutgoingMessage(session.id, menuIntro);
            await sendInteractiveListMessage(
              phone,
              'Our Menu',
              menuIntro,
              'Browse Menu',
              categorySections
            );
            return null; // Don't send another message
          }
        }
        // Small menu or fallback: use text format
        replyMessage = formatMenuForCustomer(menuItems, menuCategories);
      } else {
        replyMessage =
          "We have cakes, coffee, tea, cold drinks, and snacks! Just tell me what you'd like.";
      }
      break;

    case 'ready_for_checkout':
      // Generate and send order summary - but validate cart first
      const checkoutSession = await getSessionWithItems(session.id);
      if (!checkoutSession || checkoutSession.items.length === 0) {
        logger.warn(`⚠️ READY_FOR_CHECKOUT but cart is EMPTY! Session: ${session.id}`);
        replyMessage = "Your cart is empty! What would you like to order?";
        break;
      }
      // Show summary and ask for delivery/takeaway directly (no separate item confirmation)
      const summary = await generateOrderSummary(session.id, { includeCta: false, timezone: businessTimezone });
      if (business?.supports_delivery && business?.supports_takeaway) {
        // Use interactive buttons for delivery/takeaway choice
        await saveOutgoingMessage(session.id, summary + '\n\nHow would you like to receive your order?');
        await sendReplyButtons(phone, summary + '\n\nHow would you like to receive your order?', [
          { id: 'delivery', title: '🚚 Delivery' },
          { id: 'takeaway', title: '🏪 Takeaway' },
        ]);
        return null; // Don't send another message
      } else if (business?.supports_delivery) {
        replyMessage = summary + '\n\nPlease share your delivery address and preferred time.';
      } else {
        // Takeaway only - Use interactive list for outlet selection
        if (outlets.length > 0) {
          await updateSessionFulfillmentType(session.id, 'takeaway');
          await saveOutgoingMessage(session.id, summary + '\n\nPlease select your preferred pickup location.');
          await sendInteractiveListMessage(
            phone,
            '📍 Pickup Locations',
            summary + '\n\nPlease select your preferred pickup location:',
            'Choose Location',
            [{
              title: 'Available Outlets',
              rows: outlets.map(o => ({
                id: o.id,
                title: o.outlet_name,
                description: o.address?.substring(0, 72),
              })),
            }]
          );
          return null; // Don't send another message
        } else {
          replyMessage = summary + '\n\nPlease let us know when you would like to pick up your order.';
        }
      }
      break;

    case 'confirm_items':
      // Legacy support - treat same as ready_for_checkout
      const itemsSession = await getSessionWithItems(session.id);
      if (!itemsSession || itemsSession.items.length === 0) {
        logger.warn(`⚠️ CONFIRM_ITEMS but cart is EMPTY! Session: ${session.id}`);
        replyMessage = "Your cart is empty! What would you like to order?";
        break;
      }
      // Ask for delivery or takeaway
      if (business?.supports_delivery && business?.supports_takeaway) {
        replyMessage = "Would you like *delivery* or *takeaway*?";
      } else if (business?.supports_delivery) {
        replyMessage = "Please share your delivery address.";
      } else {
        replyMessage = "Please select your preferred pickup location.";
        if (outlets.length > 0) {
          replyMessage += '\n\n' + formatOutletsForCustomer(outlets);
        }
      }
      break;

    case 'ask_fulfillment_type':
      // Ask customer for delivery or takeaway
      if (business?.supports_delivery && business?.supports_takeaway) {
        replyMessage = aiResponse.reply || 'Would you like delivery or takeaway?';
      } else if (business?.supports_delivery) {
        replyMessage = 'We offer delivery service. Please share your delivery address.';
      } else {
        replyMessage = 'Please select your preferred pickup location.';
      }
      break;

    case 'collect_delivery_info':
      // Collect delivery address and time
      if (aiResponse.fulfillment) {
        // Set fulfillment type if not already set
        if (aiResponse.fulfillment.fulfillment_type && !session.fulfillment_type) {
          await updateSessionFulfillmentType(session.id, 'delivery');
          logger.info('Fulfillment type set to: delivery');
        }

        // Save delivery address if provided
        if (aiResponse.fulfillment.delivery_address) {
          // Try to extract time from AI response first
          let deliveryTime = aiResponse.fulfillment.delivery_time
            ? parseDeliveryTime(aiResponse.fulfillment.delivery_time, businessTimezone)
            : null;

          // Fallback: Try to extract time from the original message if AI didn't get it
          if (!deliveryTime) {
            const extracted = extractAddressAndTime(messageText, businessTimezone);
            if (extracted.time) {
              deliveryTime = extracted.time;
              logger.info(`Extracted time from message: ${extracted.time}`);
            }
          }

          await updateSessionDeliveryInfo(session.id, {
            address: aiResponse.fulfillment.delivery_address,
            time: deliveryTime || undefined,
            notes: aiResponse.fulfillment.fulfillment_notes,
          });
          logger.info(`Delivery info saved: ${aiResponse.fulfillment.delivery_address}, time: ${deliveryTime || 'not provided'}`);

          // Check if time was provided - if not, ask for it
          if (!deliveryTime) {
            replyMessage = `Got it, delivery to ${aiResponse.fulfillment.delivery_address}.\n\n⏰ What time would you like delivery?\n_Examples: 'today 5pm', 'tomorrow 3pm', 'nale 4pm', 'innu evening'_`;
          } else {
            // Show final invoice with delivery details and ask for confirmation
            const deliverySummary = await generateOrderSummary(session.id, {
              includeCta: true,
              ctaMessage: '\nPlease review your order. Reply *YES* to confirm or you can add more items.',
              timezone: businessTimezone
            });
            replyMessage = deliverySummary;
          }
        }
      }
      break;

    case 'collect_pickup_info':
      // Collect pickup outlet and time
      if (aiResponse.fulfillment) {
        // Set fulfillment type if not already set
        if (aiResponse.fulfillment.fulfillment_type && !session.fulfillment_type) {
          await updateSessionFulfillmentType(session.id, 'takeaway');
          logger.info('Fulfillment type set to: takeaway');
        }

        // If customer selected outlet (by number or name)
        if (aiResponse.fulfillment.pickup_outlet_id || messageText.match(/^\d+$/)) {
          let selectedOutlet = null;

          // Try to find outlet from customer input
          if (messageText.match(/^\d+$/)) {
            selectedOutlet = findOutletByCustomerInput(messageText, outlets);
          }

          // Or use AI-extracted outlet ID
          if (!selectedOutlet && aiResponse.fulfillment.pickup_outlet_id) {
            selectedOutlet = outlets.find(o => o.id === aiResponse?.fulfillment?.pickup_outlet_id);
          }

          if (selectedOutlet) {
            const pickupTime = aiResponse.fulfillment.pickup_time
              ? parseDeliveryTime(aiResponse.fulfillment.pickup_time, businessTimezone)
              : null;

            await updateSessionPickupInfo(session.id, {
              outlet_id: selectedOutlet.id,
              time: pickupTime || undefined,
              notes: aiResponse.fulfillment.fulfillment_notes,
            });
            logger.info(`Pickup outlet selected: ${selectedOutlet.outlet_name}`);

            // If time was NOT provided, ask for it
            if (!pickupTime) {
              replyMessage = `Great! What time would you like to pick up your order from ${selectedOutlet.outlet_name}?`;
            } else {
              // Show final invoice with pickup details and ask for confirmation
              const pickupSummary = await generateOrderSummary(session.id, {
                includeCta: true,
                ctaMessage: `\n📍 Pickup at: ${selectedOutlet.outlet_name}\n🕐 Time: ${pickupTime}\n\nPlease review your order. Reply *YES* to confirm or you can add more items.`,
                timezone: businessTimezone
              });
              replyMessage = pickupSummary;
            }
          } else {
            // Show outlets list if not found
            const outletsList = formatOutletsForCustomer(outlets);
            replyMessage = aiResponse.reply + '\n\n' + outletsList;
          }
        } else if (latestSessionData.pickup_outlet_id && !latestSessionData.pickup_time) {
          // Outlet already selected, user is providing time
          const pickupTime = aiResponse.fulfillment.pickup_time
            ? parseDeliveryTime(aiResponse.fulfillment.pickup_time, businessTimezone)
            : parseDeliveryTime(messageText, businessTimezone); // Try to parse time from message directly

          if (pickupTime) {
            await updateSessionPickupInfo(session.id, {
              outlet_id: latestSessionData.pickup_outlet_id,
              time: pickupTime,
            });
            logger.info(`Pickup time saved: ${pickupTime}`);

            // Find outlet for display
            const selectedOutlet = outlets.find(o => o.id === latestSessionData.pickup_outlet_id);
            const outletName = selectedOutlet?.outlet_name || 'selected outlet';

            // Show final invoice with pickup details and ask for confirmation
            const pickupSummary = await generateOrderSummary(session.id, {
              includeCta: true,
              ctaMessage: `\n📍 Pickup at: ${outletName}\n🕐 Time: ${pickupTime}\n\nPlease review your order. Reply *YES* to confirm or you can add more items.`,
              timezone: businessTimezone
            });
            replyMessage = pickupSummary;
          } else {
            replyMessage = "I couldn't understand that time format. Please try something like:\n• 'today 5pm'\n• 'tomorrow 10am'\n• 'nale 4pm' (Malayalam for tomorrow)";
          }
        } else if (!session.pickup_outlet_id && outlets.length > 0) {
          // Use interactive list for outlet selection
          await saveOutgoingMessage(session.id, aiResponse.reply);
          await sendInteractiveListMessage(
            phone,
            '📍 Pickup Locations',
            aiResponse.reply,
            'Choose Location',
            [{
              title: 'Available Outlets',
              rows: outlets.map(o => ({
                id: o.id,
                title: o.outlet_name,
                description: o.address?.substring(0, 72),
              })),
            }]
          );
          return null; // Don't send another message
        }
      }
      break;

    case 'confirm_order':
      // Track if fulfillment was just collected in THIS message (not a real confirmation)
      // True if: address/outlet was just provided, OR time was just provided (not a "yes" to confirm)
      const fulfillmentJustCollected = aiResponse.fulfillment && (
        (aiResponse.fulfillment.delivery_address && !latestSessionData.delivery_address) ||
        (aiResponse.fulfillment.pickup_outlet_id && !latestSessionData.pickup_outlet_id) ||
        (aiResponse.fulfillment.delivery_time && !latestSessionData.delivery_time) ||
        (aiResponse.fulfillment.pickup_time && !latestSessionData.pickup_time)
      );

      // Check if fulfillment is ALREADY COMPLETE - don't overwrite with AI's re-sent data
      // This prevents AI hallucinations (e.g., "10PM" becoming "11:00 AM") from breaking orders
      const fulfillmentAlreadyComplete = latestSessionData.fulfillment_type && (
        (latestSessionData.fulfillment_type === 'delivery' && latestSessionData.delivery_address && latestSessionData.delivery_time) ||
        (latestSessionData.fulfillment_type === 'takeaway' && latestSessionData.pickup_outlet_id && latestSessionData.pickup_time)
      );

      // FIRST: If AI provided fulfillment data with confirm_order, SAVE IT NOW
      // BUT skip if fulfillment is already complete (user is just confirming with "Yes")
      if (fulfillmentAlreadyComplete && aiResponse.fulfillment) {
        logger.info(`✅ Fulfillment already complete - skipping AI re-sent data to prevent overwrite`);
      }
      if (aiResponse.fulfillment && !fulfillmentAlreadyComplete) {
        logger.info(`📍 Saving fulfillment data from confirm_order: ${JSON.stringify(aiResponse.fulfillment)}`);

        // Save fulfillment type
        if (aiResponse.fulfillment.fulfillment_type) {
          await updateSessionFulfillmentType(session.id, aiResponse.fulfillment.fulfillment_type);
        }

        // Save delivery info
        if (aiResponse.fulfillment.fulfillment_type === 'delivery' && aiResponse.fulfillment.delivery_address) {
          let deliveryTime = aiResponse.fulfillment.delivery_time
            ? parseDeliveryTime(aiResponse.fulfillment.delivery_time, businessTimezone)
            : null;

          // Fallback: Try to extract time from original message
          if (!deliveryTime) {
            const extracted = extractAddressAndTime(messageText, businessTimezone);
            if (extracted.time) {
              deliveryTime = extracted.time;
              logger.info(`Extracted time from message (confirm_order): ${extracted.time}`);
            }
          }

          await updateSessionDeliveryInfo(session.id, {
            address: aiResponse.fulfillment.delivery_address,
            time: deliveryTime || undefined,
          });
        }

        // Save pickup info
        if (aiResponse.fulfillment.fulfillment_type === 'takeaway' && aiResponse.fulfillment.pickup_outlet_id) {
          // AI might return outlet name instead of UUID - need to look it up
          let outletId = aiResponse.fulfillment.pickup_outlet_id;

          // Check if it's not a valid UUID (AI returned name instead)
          const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(outletId);
          if (!isUUID) {
            // Try to find outlet by name or number
            const foundOutlet = findOutletByCustomerInput(outletId, outlets);
            if (foundOutlet) {
              outletId = foundOutlet.id;
              logger.info(`Resolved outlet name "${aiResponse.fulfillment.pickup_outlet_id}" to ID: ${outletId}`);
            } else {
              logger.warn(`Could not find outlet: ${aiResponse.fulfillment.pickup_outlet_id}`);
              // Don't save invalid outlet - will prompt user to select
              outletId = '';
            }
          }

          if (outletId) {
            const pickupTime = aiResponse.fulfillment.pickup_time
              ? parseDeliveryTime(aiResponse.fulfillment.pickup_time, businessTimezone)
              : null;
            await updateSessionPickupInfo(session.id, {
              outlet_id: outletId,
              time: pickupTime || undefined,
            });
          }
        }

        // If fulfillment was just collected, show invoice for confirmation instead of creating order
        if (fulfillmentJustCollected) {
          logger.info(`📋 Fulfillment just collected - showing invoice for confirmation`);
          const confirmationSummary = await generateOrderSummary(session.id, {
            includeCta: true,
            ctaMessage: '\nPlease review your order. Reply *YES* to confirm or you can add more items.',
            timezone: businessTimezone
          });
          replyMessage = confirmationSummary;
          break;
        }
      }

      // NOW fetch LATEST session data (after saving fulfillment)
      const latestSession = await getSessionWithItems(session.id);

      // VALIDATION: Check if cart has items before confirming
      if (!latestSession || latestSession.items.length === 0) {
        logger.warn(`⚠️ CONFIRM_ORDER attempted but cart is EMPTY! Session: ${session.id}`);
        replyMessage = "Your cart is empty! Please add items before confirming. What would you like to order?";
        break;
      }

      // VALIDATION: Check if fulfillment info is collected (use LATEST session data)
      if (!latestSession.fulfillment_type) {
        logger.warn(`⚠️ CONFIRM_ORDER attempted but no fulfillment type! Session: ${session.id}`);
        // Show summary and ask for fulfillment
        const orderSummary = await generateOrderSummary(session.id, { includeCta: false, timezone: businessTimezone });
        if (business?.supports_delivery && business?.supports_takeaway) {
          replyMessage = orderSummary + '\n\nWould you like *delivery* or *takeaway*?';
        } else if (business?.supports_delivery) {
          replyMessage = orderSummary + '\n\nPlease share your delivery address.';
        } else {
          replyMessage = orderSummary + '\n\nPlease select your preferred pickup location.';
          if (outlets.length > 0) {
            replyMessage += '\n\n' + formatOutletsForCustomer(outlets);
          }
        }
        break;
      }

      // For delivery, check if address is provided
      if (latestSession.fulfillment_type === 'delivery' && !latestSession.delivery_address) {
        logger.warn(`⚠️ CONFIRM_ORDER attempted but no delivery address! Session: ${session.id}`);
        replyMessage = "Please share your delivery address to complete the order.";
        break;
      }

      // For takeaway, check if outlet is selected
      if (latestSession.fulfillment_type === 'takeaway' && !latestSession.pickup_outlet_id && outlets.length > 0) {
        logger.warn(`⚠️ CONFIRM_ORDER attempted but no pickup outlet! Session: ${session.id}`);
        replyMessage = "Please select your preferred pickup location:\n\n" + formatOutletsForCustomer(outlets);
        break;
      }

      // MANDATORY: Check if date/time is provided - orders cannot be confirmed without timing
      const hasDeliveryTime = latestSession.fulfillment_type === 'delivery' && latestSession.delivery_time;
      const hasPickupTime = latestSession.fulfillment_type === 'takeaway' && latestSession.pickup_time;

      if (!hasDeliveryTime && !hasPickupTime) {
        logger.warn(`⚠️ CONFIRM_ORDER attempted but no date/time provided! Session: ${session.id}`);
        const timeExamples = "Examples: 'today 5pm', 'tomorrow 3pm', 'nale 4pm', 'innu evening'";
        if (latestSession.fulfillment_type === 'delivery') {
          replyMessage = `⏰ Please provide a delivery date and time to confirm your order.\n\n${timeExamples}`;
        } else {
          replyMessage = `⏰ Please provide a pickup date and time to confirm your order.\n\n${timeExamples}`;
        }
        break;
      }

      try {
        logger.info(`📦 Creating order with ${latestSession.items.length} items for session ${session.id}`);
        const order = await createFinalOrder(session.id);

        // businessTimezone is already defined at the start of processMessage

        // Build confirmation message with fulfillment details (use LATEST session data)
        let confirmMsg = `✅ Order confirmed!\n\n📋 Order #: *${order.order_number}*\n💰 Total: ₹${order.total_amount}`;

        if (latestSession.fulfillment_type === 'delivery') {
          confirmMsg += `\n\n🚚 *Delivery*\n📍 ${latestSession.delivery_address}`;
          if (latestSession.delivery_time) {
            confirmMsg += `\n🕐 Time: ${formatDeliveryTime(latestSession.delivery_time, businessTimezone)}`;
          }
        } else if (latestSession.fulfillment_type === 'takeaway') {
          confirmMsg += `\n\n🏪 *Takeaway*`;
          const selectedOutlet = outlets.find(o => o.id === latestSession.pickup_outlet_id);
          if (selectedOutlet) {
            confirmMsg += `\n📍 ${selectedOutlet.outlet_name}`;
          }
          if (latestSession.pickup_time) {
            confirmMsg += `\n🕐 Time: ${formatDeliveryTime(latestSession.pickup_time, businessTimezone)}`;
          }
        }

        confirmMsg += `\n\n_Save your order number *${order.order_number}* to check status or cancel._`;
        const closingMsg = business?.closing_message || 'Thank you for your order!';
        confirmMsg += `\n\n${closingMsg} 🙏`;
        replyMessage = confirmMsg;
      } catch (error) {
        logger.error('Failed to create order', error);
        const supportPhone = business?.customer_support_phone;
        replyMessage = `We encountered an issue while processing your order. Please try again.${supportPhone ? `\n\n📞 Need immediate help? Contact us: ${supportPhone}` : ''}\n\n_Your cart items are still saved. Just say 'yes' to try again._`;
      }
      break;

    case 'cancel':
      replyMessage =
        "No problem! Your order has been cancelled. Feel free to start a new order whenever you're ready!";
      break;

    case 'cancel_existing_order':
      if (aiResponse.order_id) {
        const cancelResult = await cancelOrderById(aiResponse.order_id, customer.id, businessId);
        if (cancelResult.success) {
          replyMessage = `✅ ${cancelResult.message}\n\nIf you'd like to place a new order, just let me know!`;
        } else {
          replyMessage = `❌ ${cancelResult.message}`;
        }
      } else {
        replyMessage = "Could you please provide the order number? It's the code you received when you placed the order (e.g., OKS-1).";
      }
      break;

    case 'check_order_status':
      if (aiResponse.order_id) {
        // Customer provided order number - look up specific order
        const businessTimezoneForStatus = businessTimezone;
        const statusResult = await getOrderStatus(aiResponse.order_id, customer.id, businessId, businessTimezoneForStatus);
        if (statusResult.success) {
          replyMessage = statusResult.message;
        } else {
          replyMessage = `❌ ${statusResult.message}`;
        }
      } else {
        // No order number provided - try to find their active order
        const activeOrder = await getCustomerActiveOrder(customer.id, businessId);
        if (activeOrder) {
          replyMessage = getOrderStatusMessage(activeOrder, businessTimezone);
        } else {
          replyMessage = "You don't have any active orders right now. Would you like to place one? 😊";
        }
      }
      break;

    case 'conversation_ended':
      // Just send the farewell message, no need to ask more questions
      // The AI's reply should already be a proper goodbye
      break;

    case 'ask_question':
      // Handle fulfillment data if present in ask_question
      if (aiResponse.fulfillment) {
        logger.info(`📍 Fulfillment data in ask_question: ${JSON.stringify(aiResponse.fulfillment)}`);
        logger.info(`📍 Current session fulfillment: type=${session.fulfillment_type}, addr=${session.delivery_address}`);

        // Set fulfillment type
        if (aiResponse.fulfillment.fulfillment_type && !session.fulfillment_type) {
          await updateSessionFulfillmentType(session.id, aiResponse.fulfillment.fulfillment_type);
          logger.info(`Fulfillment type set to: ${aiResponse.fulfillment.fulfillment_type}`);
        }

        // Handle delivery info
        if (aiResponse.fulfillment.fulfillment_type === 'delivery') {
          if (aiResponse.fulfillment.delivery_address) {
            let deliveryTime = aiResponse.fulfillment.delivery_time
              ? parseDeliveryTime(aiResponse.fulfillment.delivery_time, businessTimezone)
              : null;

            // Fallback: Try to extract time from original message
            if (!deliveryTime) {
              const extracted = extractAddressAndTime(messageText, businessTimezone);
              if (extracted.time) {
                deliveryTime = extracted.time;
                logger.info(`Extracted time from message (ask_question): ${extracted.time}`);
              }
            }

            await updateSessionDeliveryInfo(session.id, {
              address: aiResponse.fulfillment.delivery_address,
              time: deliveryTime || undefined,
              notes: aiResponse.fulfillment.fulfillment_notes,
            });
            logger.info(`Delivery info saved: ${aiResponse.fulfillment.delivery_address}, time: ${deliveryTime || 'not provided'}`);

            // If no time provided, prompt for it
            if (!deliveryTime) {
              replyMessage = `Got it, delivery to ${aiResponse.fulfillment.delivery_address}.\n\n⏰ What time would you like delivery?\n_Examples: 'today 5pm', 'tomorrow 3pm', 'nale 4pm', 'innu evening'_`;
            }
          }
        }

        // Handle pickup info
        if (aiResponse.fulfillment.fulfillment_type === 'takeaway') {
          // Show outlets if not selected yet
          if (!aiResponse.fulfillment.pickup_outlet_id && outlets.length > 0 && !session.pickup_outlet_id) {
            const outletsList = formatOutletsForCustomer(outlets);
            replyMessage = aiResponse.reply + '\n\n' + outletsList;
          } else if (aiResponse.fulfillment.pickup_outlet_id || messageText.match(/^\d+$/)) {
            // Try to find outlet from customer input
            let selectedOutlet = findOutletByCustomerInput(messageText, outlets);

            if (!selectedOutlet && aiResponse.fulfillment.pickup_outlet_id) {
              selectedOutlet = outlets.find(o => o.id === aiResponse.fulfillment?.pickup_outlet_id) || null;
            }

            if (selectedOutlet) {
              const pickupTime = aiResponse.fulfillment.pickup_time
                ? parseDeliveryTime(aiResponse.fulfillment.pickup_time, businessTimezone)
                : null;

              await updateSessionPickupInfo(session.id, {
                outlet_id: selectedOutlet.id,
                time: pickupTime || undefined,
                notes: aiResponse.fulfillment.fulfillment_notes,
              });
              logger.info(`Pickup outlet selected: ${selectedOutlet.outlet_name}`);
            }
          }
        }
      }
      // Use AI's reply (possibly modified above)
      break;

    case 'smalltalk':
    default:
      // Use AI's reply as is
      break;
  }

  // Prepend welcome message on first message of session
  if (isFirstMessage && business?.welcome_message) {
    replyMessage = `${business.welcome_message}\n\n${replyMessage}`;
  }

  // Add Malayalam/Manglish acknowledgment if detected (friendly touch)
  if (hasMalayalamScript) {
    // Customer used Malayalam script - acknowledge in Malayalam
    replyMessage = "മലയാളം മനസ്സിലായി! 😊 " + replyMessage;
  } else if (isManglish && wasManglishNormalized) {
    // Customer used Manglish - subtle acknowledgment (only occasionally)
    // Don't add prefix for every message, just for first interaction or significant ones
    const shouldAcknowledge = Math.random() < 0.3; // 30% chance to acknowledge
    if (shouldAcknowledge && !replyMessage.includes('കേരള') && !replyMessage.includes('😊')) {
      // Add subtle Kerala touch occasionally
      replyMessage = replyMessage + " 😊";
    }
  }

  // Save outgoing message
  await saveOutgoingMessage(session.id, replyMessage);

  logger.info(`Reply sent: ${replyMessage.substring(0, 50)}...`);

  return replyMessage;
}

export async function handleWhatsAppWebhook(
  req: Request,
  res: Response,
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

        // Get business phone number from webhook metadata
        const businessPhone = sanitizePhoneNumber(value.metadata.display_phone_number);

        // Look up business by phone number
        const business = await getBusinessByPhone(businessPhone);
        if (!business) {
          logger.warn(`Business not found for phone: ${businessPhone}`);
          continue;
        }

        logger.info(`Message received for business: ${business.name} (${business.id})`);

        // Get business timezone for date/time handling
        const businessTimezone = business.timezone || 'Asia/Kolkata';

        for (const message of value.messages) {
          const phone = sanitizePhoneNumber(message.from);

          // Handle image messages (Feature 4)
          if (message.type === 'image' && message.image) {
            logger.info(`Image received from ${phone}: ${message.image.id}`);

            // Find or create customer for notification
            const customer = await findOrCreateCustomer(phone, business.id);
            const session = await findOrCreateSession(customer.id, business.id);

            // Download and store the image
            const mediaResult = await processIncomingMedia(
              message.image.id,
              message.image.mime_type || 'image/jpeg',
              business.id
            );

            // Save message with media info
            await saveIncomingMediaMessage(
              session.id,
              'image',
              mediaResult?.mediaUrl || '',
              message.image.mime_type || 'image/jpeg',
              {
                caption: message.image.caption,
                size: mediaResult?.fileSize,
              }
            );

            // Notify business admin
            await notifyBusinessAdmin(business.id, {
              type: 'customer_image',
              customerId: customer.id,
              phone,
              imageId: message.image.id,
              message: `Customer sent image${message.image.caption ? ': ' + message.image.caption : ''}`,
            });

            // Don't send automated response if AI is paused (human takeover)
            if (!session.ai_paused) {
              const supportPhone = business.customer_support_phone;
              let imageResponse = `I see you've sent an image! 📸\n\nSince I can't view images yet, I've notified our team to check it. They'll respond shortly!`;
              if (supportPhone) {
                imageResponse += `\n\n📞 Need immediate help? Contact: ${supportPhone}`;
              }
              imageResponse += `\n\nIn the meantime, you can describe what you'd like to order? 😊`;
              await sendWhatsAppMessage(phone, imageResponse);
              await saveOutgoingMessage(session.id, imageResponse);
            }
            continue;
          }

          // Handle video messages
          if (message.type === 'video' && message.video) {
            logger.info(`Video received from ${phone}: ${message.video.id}`);

            const customer = await findOrCreateCustomer(phone, business.id);
            const session = await findOrCreateSession(customer.id, business.id);

            // Download and store the video
            const mediaResult = await processIncomingMedia(
              message.video.id,
              message.video.mime_type || 'video/mp4',
              business.id
            );

            // Save message with media info
            await saveIncomingMediaMessage(
              session.id,
              'video',
              mediaResult?.mediaUrl || '',
              message.video.mime_type || 'video/mp4',
              {
                caption: message.video.caption,
                size: mediaResult?.fileSize,
              }
            );

            // Notify business admin
            await notifyBusinessAdmin(business.id, {
              type: 'customer_video',
              customerId: customer.id,
              phone,
              imageId: message.video.id,
              message: `Customer sent video${message.video.caption ? ': ' + message.video.caption : ''}`,
            });

            // Don't send automated response if AI is paused (human takeover)
            if (!session.ai_paused) {
              const supportPhone = business.customer_support_phone;
              let videoResponse = `I see you've sent a video! 🎬\n\nI've notified our team to check it. They'll respond shortly!`;
              if (supportPhone) {
                videoResponse += `\n\n📞 Need immediate help? Contact: ${supportPhone}`;
              }
              videoResponse += `\n\nIn the meantime, you can describe what you'd like to order? 😊`;
              await sendWhatsAppMessage(phone, videoResponse);
              await saveOutgoingMessage(session.id, videoResponse);
            }
            continue;
          }

          // Handle document messages
          if (message.type === 'document' && message.document) {
            logger.info(`Document received from ${phone}: ${message.document.id}`);

            const customer = await findOrCreateCustomer(phone, business.id);
            const session = await findOrCreateSession(customer.id, business.id);

            // Download and store the document
            const mediaResult = await processIncomingMedia(
              message.document.id,
              message.document.mime_type || 'application/pdf',
              business.id
            );

            // Save message with media info
            await saveIncomingMediaMessage(
              session.id,
              'document',
              mediaResult?.mediaUrl || '',
              message.document.mime_type || 'application/pdf',
              {
                caption: message.document.caption,
                filename: message.document.filename,
                size: mediaResult?.fileSize,
              }
            );

            // Notify business admin
            await notifyBusinessAdmin(business.id, {
              type: 'customer_document',
              customerId: customer.id,
              phone,
              imageId: message.document.id,
              message: `Customer sent document: ${message.document.filename || 'document'}`,
            });

            // Don't send automated response if AI is paused (human takeover)
            if (!session.ai_paused) {
              const supportPhone = business.customer_support_phone;
              let docResponse = `I received your document! 📄\n\nI've notified our team to review it. They'll respond shortly!`;
              if (supportPhone) {
                docResponse += `\n\n📞 Need immediate help? Contact: ${supportPhone}`;
              }
              await sendWhatsAppMessage(phone, docResponse);
              await saveOutgoingMessage(session.id, docResponse);
            }
            continue;
          }

          // Handle voice/audio messages (Feature 2 - Speech-to-Text)
          if ((message.type === 'audio' || message.type === 'voice') && (message.audio || message.voice)) {
            const audioData = message.audio || message.voice;
            const audioId = audioData?.id;
            const audioMimeType = audioData?.mime_type || 'audio/ogg';
            logger.info(`Voice message received from ${phone}: ${audioId}`);

            const customer = await findOrCreateCustomer(phone, business.id);
            const session = await findOrCreateSession(customer.id, business.id);

            // Download and store the audio (so admin can listen to it)
            const mediaResult = await processIncomingMedia(
              audioId!,
              audioMimeType,
              business.id
            );

            // If AI is paused (human takeover), just save the audio and don't process/respond
            if (session.ai_paused) {
              logger.info('AI paused - saving voice message without automated response');
              await saveIncomingMediaMessage(
                session.id,
                'audio',
                mediaResult?.mediaUrl || '',
                audioMimeType,
                { size: mediaResult?.fileSize }
              );
              continue;
            }

            // Check if voice feature is enabled (premium feature)
            if (!isVoiceEnabled()) {
              logger.info('Voice feature disabled');
              await saveIncomingMediaMessage(
                session.id,
                'audio',
                mediaResult?.mediaUrl || '',
                audioMimeType,
                { size: mediaResult?.fileSize }
              );
              const notEnabledReply = "Oops! I'm not able to understand voice messages yet. 🙈\n\nCould you please type your message instead? I'd love to help you! 💬";
              await sendWhatsAppMessage(phone, notEnabledReply);
              await saveOutgoingMessage(session.id, notEnabledReply);
              continue;
            }

            // Check if speech service is available
            if (!isSpeechServiceAvailable()) {
              logger.warn('Speech service not configured - voice messages disabled');
              await saveIncomingMediaMessage(
                session.id,
                'audio',
                mediaResult?.mediaUrl || '',
                audioMimeType,
                { size: mediaResult?.fileSize }
              );
              const noSpeechReply = "I received your voice message! 🎤\n\nVoice transcription is not available right now. Could you please type your message instead? 😊";
              await sendWhatsAppMessage(phone, noSpeechReply);
              await saveOutgoingMessage(session.id, noSpeechReply);
              continue;
            }

            try {
              // Transcribe voice message
              const transcription = await processVoiceMessage(audioId!);
              logger.info(`Voice transcribed: "${transcription.substring(0, 50)}..."`);

              // Save the audio with transcription as caption
              await saveIncomingMediaMessage(
                session.id,
                'audio',
                mediaResult?.mediaUrl || '',
                audioMimeType,
                {
                  caption: transcription,
                  size: mediaResult?.fileSize,
                }
              );

              // Process transcription as a normal text message
              const reply = await processMessage(phone, transcription, business.id);

              if (reply !== null) {
                // Prepend transcription confirmation to the reply
                const voiceReply = `🎤 _"${transcription}"_\n\n${reply}`;
                await sendWhatsAppMessage(phone, voiceReply);
                // Note: processMessage already saves outgoing message, so we update it
              }
            } catch (error) {
              logger.error('Voice processing failed', error);
              // Still save the audio even if transcription failed
              await saveIncomingMediaMessage(
                session.id,
                'audio',
                mediaResult?.mediaUrl || '',
                audioMimeType,
                { size: mediaResult?.fileSize }
              );

              const supportPhone = business.customer_support_phone;
              let errorReply = "Sorry, I couldn't understand your voice message. 🎤\n\nCould you please type your message instead?";
              if (supportPhone) {
                errorReply += `\n\n📞 Need help? Contact: ${supportPhone}`;
              }
              await sendWhatsAppMessage(phone, errorReply);
              await saveOutgoingMessage(session.id, errorReply);
            }
            continue;
          }

          // Handle location messages (Feature 3)
          if (message.type === 'location' && message.location) {
            const location = message.location;
            logger.info(`[DEBUG-LOC] Step 1: Location received from ${phone}: ${location.latitude}, ${location.longitude}`);

            try {
              logger.info(`[DEBUG-LOC] Step 2: Finding/creating customer...`);
              const customer = await findOrCreateCustomer(phone, business.id);
              logger.info(`[DEBUG-LOC] Step 2 done: customer.id=${customer.id}`);

              logger.info(`[DEBUG-LOC] Step 3: Finding/creating session...`);
              const session = await findOrCreateSession(customer.id, business.id);
              logger.info(`[DEBUG-LOC] Step 3 done: session.id=${session.id}`);

              logger.info(`[DEBUG-LOC] Step 4: Getting session with items...`);
              const sessionWithItems = await getSessionWithItems(session.id);
              logger.info(`[DEBUG-LOC] Step 4 done: fulfillment_type=${sessionWithItems?.fulfillment_type}, delivery_address=${sessionWithItems?.delivery_address}`);

              // Use address/name from location if available, otherwise reverse geocode
              // The lat/long will be stored in separate columns for map display
              let displayAddress = location.address || location.name;
              logger.info(`[DEBUG-LOC] Step 5: WhatsApp address=${displayAddress || 'NONE'}`);

              // If no address provided by WhatsApp, reverse geocode the coordinates
              if (!displayAddress) {
                logger.info(`[DEBUG-LOC] Step 5a: Reverse geocoding ${location.latitude}, ${location.longitude}`);
                displayAddress = await getAddressFromCoordinates(location.latitude, location.longitude);
                logger.info(`[DEBUG-LOC] Step 5a done: geocoded address=${displayAddress}`);
              }

              const logAddress = displayAddress || `${location.latitude}, ${location.longitude}`;
              logger.info(`[DEBUG-LOC] Step 6: Saving incoming message...`);
              await saveIncomingMessage(session.id, `[Location: ${logAddress}]`);
              logger.info(`[DEBUG-LOC] Step 6 done`);

              // If customer is in delivery flow and hasn't provided address yet
              if (sessionWithItems?.fulfillment_type === 'delivery' && !sessionWithItems.delivery_address) {
                logger.info(`[DEBUG-LOC] Step 7: Updating delivery info...`);
                await updateSessionDeliveryInfo(session.id, {
                  address: displayAddress,
                  latitude: location.latitude,
                  longitude: location.longitude,
                });
                logger.info(`[DEBUG-LOC] Step 7 done`);

                // Show date selection buttons instead of asking for time as text
                if (!sessionWithItems.delivery_time) {
                  logger.info(`[DEBUG-LOC] Step 8: Sending date buttons...`);
                  const datePrompt = `📍 Location saved!\n\nWhen would you like delivery?`;
                  await saveOutgoingMessage(session.id, datePrompt);
                  await sendReplyButtons(phone, datePrompt, [
                    { id: 'date_today_delivery', title: '📅 Today' },
                    { id: 'date_tomorrow_delivery', title: '📅 Tomorrow' },
                    { id: 'date_other_delivery', title: '📅 Other' },
                  ]);
                  logger.info(`[DEBUG-LOC] Step 8 done`);
                } else {
                  logger.info(`[DEBUG-LOC] Step 8b: Generating order summary...`);
                  const locationSummary = await generateOrderSummary(session.id, {
                    includeCta: true,
                    ctaMessage: '\n📍 Location saved! Reply *YES* to confirm your order.',
                    timezone: businessTimezone
                  });
                  await sendWhatsAppMessage(phone, locationSummary);
                  await saveOutgoingMessage(session.id, locationSummary);
                  logger.info(`[DEBUG-LOC] Step 8b done`);
                }
              } else {
                logger.info(`[DEBUG-LOC] Step 9: Not in delivery flow, sending generic reply...`);
                const locationReply = "Thanks for sharing your location! 📍 We've saved it for your delivery.";
                await sendWhatsAppMessage(phone, locationReply);
                await saveOutgoingMessage(session.id, locationReply);
                logger.info(`[DEBUG-LOC] Step 9 done`);
              }
              logger.info(`[DEBUG-LOC] Location handling complete`);
            } catch (locError) {
              logger.error(`[DEBUG-LOC] ERROR at location handling:`, locError);
              throw locError; // Re-throw to hit outer catch
            }
            continue;
          }

          // Handle interactive messages (button/list replies) (Feature 2)
          let messageText = '';
          if (message.type === 'interactive' && message.interactive) {
            const interactive = message.interactive;

            if (interactive.type === 'button_reply' && interactive.button_reply) {
              const buttonId = interactive.button_reply.id;
              logger.info(`Button reply from ${phone}: ${buttonId}`);

              // Handle takeaway button - show interactive outlet list
              if (buttonId === 'takeaway') {
                const customer = await findOrCreateCustomer(phone, business.id);
                const session = await findOrCreateSession(customer.id, business.id);
                const businessOutlets = await getBusinessOutlets(business.id);

                // Set fulfillment type to takeaway and CLEAR any previous delivery info
                await updateSessionFulfillmentType(session.id, 'takeaway');

                if (businessOutlets.length > 0) {
                  await saveIncomingMessage(session.id, '[Selected: Takeaway]');
                  const outletPrompt = 'Great! Please select your preferred pickup location:';
                  await saveOutgoingMessage(session.id, outletPrompt);
                  await sendInteractiveListMessage(
                    phone,
                    '📍 Pickup Locations',
                    outletPrompt,
                    'Choose Location',
                    [{
                      title: 'Available Outlets',
                      rows: businessOutlets.map(o => ({
                        id: o.id,
                        title: o.outlet_name,
                        description: o.address?.substring(0, 72),
                      })),
                    }]
                  );
                  continue;
                }
              }

              // Handle delivery button - set fulfillment type and CLEAR any previous takeaway info
              if (buttonId === 'delivery') {
                const customer = await findOrCreateCustomer(phone, business.id);
                const session = await findOrCreateSession(customer.id, business.id);

                // Set fulfillment type to delivery (this will clear takeaway info in the handler)
                await updateSessionFulfillmentType(session.id, 'delivery');
                await saveIncomingMessage(session.id, '[Selected: Delivery]');
                const deliveryPrompt = "Great! Let's set up your 📍 delivery.\n\nYou can either *share your location* or *type your address* with preferred time.\n\n_Examples: 'MG Road, tomorrow 5pm', 'Kottakkal, today 6pm'_";
                await saveOutgoingMessage(session.id, deliveryPrompt);
                // Send location request with the prompt
                await sendLocationRequest(phone, deliveryPrompt);
                continue;
              }

              // Handle SIZE selection buttons from menu browser (format: size:{itemId}:{sizeName})
              if (buttonId.startsWith('size:')) {
                const parts = buttonId.split(':');
                if (parts.length >= 3) {
                  const itemId = parts[1];
                  const sizeName = parts.slice(2).join(':'); // In case size name has colons

                  const menuItem = await getMenuItemById(itemId);
                  if (menuItem) {
                    const customer = await findOrCreateCustomer(phone, business.id);
                    const session = await findOrCreateSession(customer.id, business.id);

                    await saveIncomingMessage(session.id, `[Selected size: ${sizeName}]`);
                    await saveOrderItem(session.id, {
                      name: menuItem.name,
                      quantity: 1,
                      size_or_weight: sizeName
                    }, business.id);

                    const addedMsg = `Added *${menuItem.name}* (${sizeName}) to your order. Anything else?`;
                    await sendWhatsAppMessage(phone, addedMsg);
                    await saveOutgoingMessage(session.id, addedMsg);
                    continue;
                  }
                }
              }

              // Handle DATE selection buttons (Today/Tomorrow/Other)
              if (buttonId.startsWith('date_')) {
                const customer = await findOrCreateCustomer(phone, business.id);
                const session = await findOrCreateSession(customer.id, business.id);
                const isDelivery = buttonId.includes('_delivery');
                const fulfillmentType = isDelivery ? 'delivery' : 'takeaway';

                if (buttonId.includes('_today_')) {
                  // Store date selection and show time buttons
                  pendingDateSelectionMap.set(session.id, { date: 'today', fulfillmentType });
                  await saveIncomingMessage(session.id, '[Selected: Today]');

                  // Different time options for delivery vs takeaway
                  const timePrompt = `📅 *Today* - What time?`;
                  await saveOutgoingMessage(session.id, timePrompt);

                  if (isDelivery) {
                    // Delivery: In 1 hour, In 1.5 hours, Other
                    await sendReplyButtons(phone, timePrompt, [
                      { id: 'time_1hour', title: '🕐 In 1 hour' },
                      { id: 'time_1_5hour', title: '🕐 In 1.5 hours' },
                      { id: 'time_other', title: '⏰ Other' },
                    ]);
                  } else {
                    // Takeaway: In 30 min, In 1 hour, Other
                    await sendReplyButtons(phone, timePrompt, [
                      { id: 'time_30min', title: '🕐 In 30 min' },
                      { id: 'time_1hour', title: '🕐 In 1 hour' },
                      { id: 'time_other', title: '⏰ Other' },
                    ]);
                  }
                  continue;
                }

                if (buttonId.includes('_tomorrow_')) {
                  // Store date selection and show time buttons for tomorrow
                  pendingDateSelectionMap.set(session.id, { date: 'tomorrow', fulfillmentType });
                  await saveIncomingMessage(session.id, '[Selected: Tomorrow]');

                  const timePrompt = `📅 *Tomorrow* - What time?`;
                  await saveOutgoingMessage(session.id, timePrompt);

                  // Tomorrow: Morning, Afternoon, Other
                  await sendReplyButtons(phone, timePrompt, [
                    { id: 'time_morning', title: '🌅 Morning (10 AM)' },
                    { id: 'time_afternoon', title: '🌞 Afternoon (2 PM)' },
                    { id: 'time_other', title: '⏰ Other' },
                  ]);
                  continue;
                }

                if (buttonId.includes('_other_')) {
                  // User wants to specify custom date/time - fall back to text input
                  pendingDateSelectionMap.delete(session.id);
                  await saveIncomingMessage(session.id, '[Selected: Other date]');

                  const customPrompt = `Please type your preferred date and time.\n\n_Examples: 'Monday 5pm', 'Dec 20 at 3pm', 'next week Tuesday morning'_`;
                  await sendWhatsAppMessage(phone, customPrompt);
                  await saveOutgoingMessage(session.id, customPrompt);
                  continue;
                }
              }

              // Handle TIME selection buttons
              if (buttonId.startsWith('time_')) {
                const customer = await findOrCreateCustomer(phone, business.id);
                const session = await findOrCreateSession(customer.id, business.id);
                const sessionWithItems = await getSessionWithItems(session.id);
                const pendingDate = pendingDateSelectionMap.get(session.id);

                if (buttonId === 'time_other') {
                  // User wants custom time - fall back to text input
                  pendingDateSelectionMap.delete(session.id);
                  await saveIncomingMessage(session.id, '[Selected: Other time]');

                  const dateText = pendingDate?.date === 'tomorrow' ? 'tomorrow' : 'today';
                  const customPrompt = `Please type your preferred time for ${dateText}.\n\n_Examples: '5pm', '3:30 PM', 'evening'_`;
                  await sendWhatsAppMessage(phone, customPrompt);
                  await saveOutgoingMessage(session.id, customPrompt);
                  continue;
                }

                // Calculate actual datetime from button selection
                const dateSelection = pendingDate?.date || 'today';
                const calculatedTime = calculateDateTimeFromButtons(dateSelection, buttonId, businessTimezone);

                if (!calculatedTime) {
                  logger.error(`Failed to calculate time for: ${dateSelection} ${buttonId}`);
                  await sendWhatsAppMessage(phone, "Sorry, there was an issue. Please type your preferred time.");
                  continue;
                }

                // Get readable time label
                const timeLabels: Record<string, string> = {
                  'time_30min': 'In 30 minutes',
                  'time_1hour': 'In 1 hour',
                  'time_1_5hour': 'In 1.5 hours',
                  'time_morning': 'Morning (10 AM)',
                  'time_afternoon': 'Afternoon (2 PM)',
                };
                const timeLabel = timeLabels[buttonId] || buttonId;
                await saveIncomingMessage(session.id, `[Selected: ${timeLabel}]`);

                // Save time and show final invoice
                const fulfillmentType = pendingDate?.fulfillmentType || sessionWithItems?.fulfillment_type;

                if (fulfillmentType === 'delivery') {
                  await updateSessionDeliveryInfo(session.id, {
                    address: sessionWithItems?.delivery_address || '',
                    time: calculatedTime,
                  });
                } else {
                  await updateSessionPickupInfo(session.id, {
                    outlet_id: sessionWithItems?.pickup_outlet_id || '',
                    time: calculatedTime,
                  });
                }

                // Clear pending date selection
                pendingDateSelectionMap.delete(session.id);

                // Show final invoice
                const finalSummary = await generateOrderSummary(session.id, {
                  includeCta: true,
                  ctaMessage: '\nPlease review your order. Reply *YES* to confirm.',
                  timezone: businessTimezone,
                });
                await sendWhatsAppMessage(phone, finalSummary);
                await saveOutgoingMessage(session.id, finalSummary);
                continue;
              }

              messageText = buttonId;
            } else if (interactive.type === 'list_reply' && interactive.list_reply) {
              const selectedId = interactive.list_reply.id;
              logger.info(`List reply from ${phone}: ${selectedId}`);

              // Handle outlet selection
              const customer = await findOrCreateCustomer(phone, business.id);
              const session = await findOrCreateSession(customer.id, business.id);
              const businessOutlets = await getBusinessOutlets(business.id);

              // Handle super group selection (first level: Food, Drinks, etc.)
              if (selectedId.startsWith('group:')) {
                const groupName = selectedId.replace('group:', '');
                const menuCategories = await getMenuCategories(business.id);
                const categorySections = buildCategoriesInGroup(groupName, menuCategories);

                if (categorySections.length > 0 && categorySections[0].rows.length > 0) {
                  await saveIncomingMessage(session.id, `[Browsing: ${groupName}]`);
                  await sendInteractiveListMessage(
                    phone,
                    groupName,
                    `Select a category from ${groupName}`,
                    'View Categories',
                    categorySections
                  );
                  continue;
                }
                // Group empty - show menu again
                messageText = 'menu';
              }
              // Handle category selection from menu browser
              else if (selectedId.startsWith('cat:')) {
                const categoryId = selectedId.replace('cat:', '');
                const category = await getCategoryById(categoryId);
                if (category) {
                  const categoryItems = await getMenuItemsByCategory(business.id, categoryId);
                  if (categoryItems.length > 0) {
                    const { sections, hasMore, totalItems } = buildItemListSections(categoryItems, category.name);
                    const itemListBody = hasMore
                      ? `${category.name} (${totalItems} items) - Showing first 10`
                      : `${category.name} (${totalItems} items)`;

                    await saveIncomingMessage(session.id, `[Browsing: ${category.name}]`);
                    await sendInteractiveListMessage(
                      phone,
                      category.name,
                      itemListBody,
                      'Select Item',
                      sections
                    );
                    continue;
                  }
                }
                // Category not found or empty - show menu again
                messageText = 'menu';
              }
              // Handle item selection from category browser
              else if (selectedId.startsWith('item:')) {
                const itemId = selectedId.replace('item:', '');
                const menuItem = await getMenuItemById(itemId);
                if (menuItem) {
                  await saveIncomingMessage(session.id, `[Selected: ${menuItem.name}]`);

                  // Check if item has multiple sizes
                  if (menuItem.sizes && menuItem.sizes.length > 1) {
                    // Show size selection buttons
                    const sizeButtons = buildSizeButtons(menuItem);
                    const sizePrompt = `*${menuItem.name}*\n\nSelect size:`;
                    await saveOutgoingMessage(session.id, sizePrompt);
                    await sendReplyButtons(phone, sizePrompt, sizeButtons);
                    continue;
                  } else {
                    // Single price or single size - add directly
                    const size = menuItem.sizes?.[0]?.name;
                    // const price = menuItem.sizes?.[0]?.price || menuItem.price;

                    await saveOrderItem(session.id, {
                      name: menuItem.name,
                      quantity: 1,
                      size_or_weight: size
                    }, business.id);

                    const addedMsg = size
                      ? `Added *${menuItem.name}* (${size}) to your order. Anything else?`
                      : `Added *${menuItem.name}* to your order. Anything else?`;
                    await sendWhatsAppMessage(phone, addedMsg);
                    await saveOutgoingMessage(session.id, addedMsg);
                    continue;
                  }
                }
                // Item not found - continue to normal processing
                messageText = 'menu';
              }
              // Handle outlet selection (existing)
              else {
                const selectedOutlet = businessOutlets.find(o => o.id === selectedId);
                if (selectedOutlet) {
                  await updateSessionFulfillmentType(session.id, 'takeaway');
                  await updateSessionPickupInfo(session.id, { outlet_id: selectedOutlet.id });

                  await saveIncomingMessage(session.id, `[Selected: ${selectedOutlet.outlet_name}]`);

                  // Show date selection buttons instead of asking for time as text
                  const datePrompt = `📍 Pickup at: *${selectedOutlet.outlet_name}*\n\nWhen would you like to pick up?`;
                  await saveOutgoingMessage(session.id, datePrompt);
                  await sendReplyButtons(phone, datePrompt, [
                    { id: 'date_today_takeaway', title: '📅 Today' },
                    { id: 'date_tomorrow_takeaway', title: '📅 Tomorrow' },
                    { id: 'date_other_takeaway', title: '📅 Other' },
                  ]);
                  continue;
                }

                // If not outlet, treat ID as message text
                messageText = selectedId;
              }
            }
          } else if (message.type === 'text' && message.text?.body) {
            messageText = sanitizeMessage(message.text.body);
          } else {
            logger.debug(`Skipping unsupported message type: ${message.type}`);
            continue;
          }

          if (!isValidPhoneNumber(phone)) {
            logger.warn(`Invalid phone number: ${message.from}`);
            continue;
          }

          if (!isValidMessage(messageText)) {
            logger.warn('Empty message received');
            continue;
          }

          try {
            // Use business ID from phone lookup
            const reply = await processMessage(phone, messageText, business.id);
            // Only send message if AI is not paused (reply will be null if paused)
            if (reply !== null) {
              await sendWhatsAppMessage(phone, reply);
            }
          } catch (error) {
            logger.error('Error processing message', error);
            const supportPhone = business.customer_support_phone;
            let errorMsg = "We're experiencing a temporary issue. Please try again in a moment.";
            if (supportPhone) {
              errorMsg += `\n\n📞 Need immediate help? Contact us: ${supportPhone}`;
            }
            errorMsg += "\n\n_Tip: You can continue by telling us what you'd like to order._";
            await sendWhatsAppMessage(phone, errorMsg);
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
    const { phone, message, businessId } = req.body as TestMessageRequest & { businessId?: string };

    if (!phone || !message) {
      res.status(400).json({ error: 'Phone and message are required' });
      return;
    }

    if (!businessId) {
      res.status(400).json({ error: 'Business ID is required' });
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

    const reply = await processMessage(sanitizedPhone, sanitizedMessage, businessId);

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

/**
 * Alias for processMessage - used by webjsHandler
 * Keeping separate name for clarity in imports
 */
export const processMessageForWebJS = processMessage;
