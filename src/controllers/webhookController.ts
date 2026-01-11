import { Request, Response } from 'express';
import { WhatsAppWebhookBody, TestMessageRequest, SessionItem, MenuAddon, Session } from '../types';
import { findOrCreateCustomer } from '../services/customerService';
import {
  findOrCreateSession,
  updateSessionActivity,
  getSessionWithItems,
  isAIPaused,
  updateSessionItemCustomText,
  updateSessionLanguage,
  getSessionLanguage,
} from '../services/sessionService';
import {
  getRecentMessages,
  saveIncomingMessage,
  saveOutgoingMessage,
  saveIncomingMediaMessage,
} from '../services/messageService';
import { processIncomingMedia } from '../services/mediaService';
import { processMessageWithAI, classifyCustomTextResponse } from '../services/aiService';
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
  validateOperatingHours,
  calculateDistanceBasedDeliveryFee,
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
  sendImage,
  markAsRead,
} from '../services/whatsapp';
import { getAmenityBySlug, getBusinessAmenities } from '../services/amenityService';
import { getMenuPdfUrl, menuPdfExists } from '../services/pdfService';
import { getAddressFromCoordinates } from '../services/geocodingService';
import {
  processVoiceMessage,
  isSpeechServiceAvailable,
  isVoiceEnabled,
} from '../services/speechService';
import { notifyBusinessAdmin } from '../services/notificationService';
import {
  processCakeImage,
  getPendingQuoteForSession,
  getSentQuoteForSession,
  markQuoteAsAccepted,
  getAcceptedQuoteForSession,
  updateQuoteTimeRequest,
  createQuoteRevision,
  analyzeImageWithGemini,
} from '../services/cakeQuoteService';
import { getFullPricingConfig } from '../services/cakePricingService';
import {
  isValidPhoneNumber,
  sanitizePhoneNumber,
  isValidMessage,
  sanitizeMessage,
} from '../utils/validators';
import { logger } from '../utils/logger';
import { createIntervention } from '../services/interventionService';
import { emitInterventionCreated } from '../services/socketService';
import { getActiveMenuPdfConfigs, getMenuPdfConfigBySlug, getLocalizedMenuName } from '../services/menuPdfConfigService';
import {
  updateSessionCustomCakeContext,
  clearSessionCustomCakeContext,
  pauseAI
} from '../services/sessionService';
import { SupportedLanguage, detectLanguageRequest, t } from '../i18n';

const CAKE_KEYWORDS = ['cake', 'birthday', 'anniversary', 'kg', 'flavor', 'chocolate', 'vanilla', 'fondant', 'design', 'custom'];

// Track last added item per session for add-on attachment
const lastAddedItemMap = new Map<string, string>(); // sessionId -> itemId

// Track pending custom text questions per session
const pendingCustomTextMap = new Map<string, { itemId: string; prompt: string }>(); // sessionId -> { itemId, prompt }

// Track pending addon selections per session
const pendingAddonSelectionMap = new Map<string, { itemId: string; addons: MenuAddon[] }>(); // sessionId -> { itemId, addons }

// Track pending date selection for time button flow (date selected, waiting for time)
const pendingDateSelectionMap = new Map<string, { date: 'today' | 'tomorrow'; fulfillmentType: 'delivery' | 'takeaway' }>(); // sessionId -> { date, fulfillmentType }

// Message debounce buffer - waits for user to finish typing before processing
interface PendingMessage {
  messages: string[];
  businessId: string;
  customerName?: string;
  timer: NodeJS.Timeout;
}
const messageDebounceMap = new Map<string, PendingMessage>(); // phone -> pending messages

const DEBOUNCE_DELAY_MS = 10000; // Wait 10 seconds for more messages

async function processDebouncedMessages(phone: string): Promise<void> {
  const pending = messageDebounceMap.get(phone);
  if (!pending) return;

  messageDebounceMap.delete(phone);

  // Combine all messages into one
  const combinedMessage = pending.messages.join('\n');

  logger.info(`Processing ${pending.messages.length} debounced message(s) for ${phone}`);

  try {
    const reply = await processMessage(
      phone,
      combinedMessage,
      pending.businessId,
      pending.customerName
    );
    if (reply !== null) {
      await sendWhatsAppMessage(phone, reply);
    }
  } catch (error) {
    logger.error('Error processing debounced messages', error);
    try {
      const customer = await findOrCreateCustomer(phone, pending.businessId, pending.customerName);
      const { session } = await findOrCreateSession(customer.id, pending.businessId);
      const lang: SupportedLanguage = getSessionLanguage(session);
      await sendWhatsAppMessage(phone, t('error.generic', lang));
    } catch (langError) {
      logger.error('Could not get session language for error message', langError);
      // Fallback to default language
      await sendWhatsAppMessage(phone, t('error.generic', 'en'));
    }
  }
}

function queueMessageForDebounce(
  phone: string,
  messageText: string,
  businessId: string,
  customerName?: string
): void {
  const existing = messageDebounceMap.get(phone);

  if (existing) {
    // Clear existing timer and add message to queue
    clearTimeout(existing.timer);
    existing.messages.push(messageText);
    existing.timer = setTimeout(() => processDebouncedMessages(phone), DEBOUNCE_DELAY_MS);
    logger.debug(`Added to debounce queue for ${phone}, total: ${existing.messages.length}`);
  } else {
    // Create new queue
    const timer = setTimeout(() => processDebouncedMessages(phone), DEBOUNCE_DELAY_MS);
    messageDebounceMap.set(phone, {
      messages: [messageText],
      businessId,
      customerName,
      timer,
    });
    logger.debug(`Created debounce queue for ${phone}`);
  }
}

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

// Validate if user input looks like a valid delivery address (not an order or question)
function validateAddressInput(input: string): boolean {
  const text = input.trim().toLowerCase();

  // Too short to be a valid address
  if (text.length < 8) {
    return false;
  }

  // Ends with question mark - likely a question
  if (text.endsWith('?')) {
    return false;
  }

  // Starts with ordering keywords (English + Malayalam)
  const orderingPatterns = [
    /^(i\s*want|add|give\s*me|order|get\s*me|need|can\s*i\s*(have|get|order))/i,
    /^(എനിക്ക്\s*വേണം|ഒരു|ഒന്ന്|കുറച്ച്|add|ചേർക്കൂ)/i, // Malayalam ordering words
    /^(one|two|three|four|five|1|2|3|4|5)\s+(cake|item|piece)/i,
  ];

  for (const pattern of orderingPatterns) {
    if (pattern.test(text)) {
      return false;
    }
  }

  // Contains menu item keywords - likely ordering
  const menuKeywords = ['cake', 'pastry', 'bread', 'cookie', 'muffin', 'cupcake', 'brownie', 'kg', 'gram'];
  const hasMenuKeyword = menuKeywords.some(kw => text.includes(kw));
  if (hasMenuKeyword && text.length < 25) {
    // Short message with menu keyword - probably an order
    return false;
  }

  // Contains question words at start
  const questionPatterns = [
    /^(what|when|where|how|why|which|can|do|is|are|will|would|could)/i,
    /^(എന്താണ്|എപ്പോൾ|എവിടെ|എങ്ങനെ)/i, // Malayalam question words
  ];

  for (const pattern of questionPatterns) {
    if (pattern.test(text)) {
      return false;
    }
  }

  // Common cancel/no keywords
  if (/^(no|nope|cancel|stop|nevermind|venda|വേണ്ട|അല്ല)$/i.test(text)) {
    return false;
  }

  // Common yes/confirm keywords (not an address)
  if (/^(yes|yeah|yep|ok|okay|sure|confirm|ശരി|അതെ)$/i.test(text)) {
    return false;
  }

  // Looks like an address - contains address indicators OR is reasonably long
  const addressIndicators = [
    'road', 'street', 'lane', 'near', 'opposite', 'behind', 'beside', 'floor',
    'house', 'building', 'apartment', 'flat', 'block', 'tower', 'complex',
    'junction', 'circle', 'cross', 'main', 'bypass', 'highway', 'nagar',
    'puram', 'vila', 'garden', 'colony', 'layout', 'extension', 'sector',
    'phase', 'plot', 'door', 'no.', 'no:', 'number', 'po', 'p.o', 'pin',
    // Malayalam address indicators
    'റോഡ്', 'സ്ട്രീറ്റ്', 'ലൈൻ', 'സമീപം', 'അടുത്ത്', 'എതിർവശം', 'പിന്നിൽ',
    'വീട്', 'ബിൽഡിംഗ്', 'അപ്പാർട്ട്മെന്റ്', 'ഫ്ലാറ്റ്', 'നഗർ', 'പുരം',
  ];

  const hasAddressIndicator = addressIndicators.some(indicator =>
    text.includes(indicator.toLowerCase())
  );

  // If has address indicator or is long enough (likely descriptive address)
  if (hasAddressIndicator || text.length >= 15) {
    return true;
  }

  return false;
}

/**
 * Core message processing logic - shared between Meta and WebJS handlers
 * Exported as processMessageForWebJS for use by webjsHandler
 */
export async function processMessage(
  phone: string,
  messageText: string,
  businessId: string,
  customerName?: string
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

  // Flag to track if user asked a question during custom text prompt (skip addon check)
  let isCustomTextQuestion = false;

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
  const customer = await findOrCreateCustomer(phone, businessId, customerName);

  // Find or create active session for this business
  const { session, isNew: isNewSession } = await findOrCreateSession(customer.id, businessId);

  // Update session activity
  await updateSessionActivity(session.id);

  // i18n: Detect language switch request and update session
  const langRequest = detectLanguageRequest(originalMessage);
  if (langRequest && langRequest !== session.language) {
    await updateSessionLanguage(session.id, langRequest);
    session.language = langRequest;
    logger.info(`Language switched to ${langRequest} for session ${session.id}`);
  }
  const lang: SupportedLanguage = getSessionLanguage(session);

  // Send welcome message with menu button(s) for new sessions
  if (isNewSession) {
    const welcomeMsg = t('menu.aiWelcome', lang, { businessName: business?.name || 'our store' });

    // Get active menu PDF configs for dynamic buttons
    const menuConfigs = business?.id ? await getActiveMenuPdfConfigs(business.id) : [];

    let menuButtons: Array<{ id: string; title: string }>;
    if (menuConfigs.length > 0) {
      // Dynamic buttons based on menu configs (max 3 buttons for WhatsApp)
      // Add 📖 emoji prefix, limit title to 18 chars (20 - emoji - space)
      menuButtons = menuConfigs.slice(0, 3).map(config => ({
        id: `show_menu_${config.slug}`,
        title: `📖 ${getLocalizedMenuName(config, lang).substring(0, 17)}`
      }));
    } else {
      // Fallback to single generic button with emoji
      menuButtons = [{ id: 'show_menu', title: `📖 ${t('menu.browseBtn', lang)}` }];
    }

    await sendReplyButtons(phone, welcomeMsg, menuButtons);
    await saveOutgoingMessage(session.id, welcomeMsg);
    return null; // Don't continue to AI - welcome sent
  }

  // ============================================
  // CUSTOM CAKE: Delayed Clarification Check
  // ============================================

  // 1. Check if we need to ask for clarification (30s passed since image)
  const sentClarification = await checkPendingImageClarification(session, phone, businessId);
  if (sentClarification) {
    return null; // Clarification message sent, stop processing
  }

  // 2. Check if user is responding to clarification ("Is this a cake?")
  if (session.custom_cake_context?.awaiting_clarification) {
    const isYes = /^(yes|yeah|yep|hai|aanu|ശരി|correct|ok|confirm)/i.test(normalizedMessage);
    const isNo = /^(no|nope|illa|അല്ല|wrong|cancel)/i.test(normalizedMessage);
    // Also check if text contains cake keywords (implicit yes)
    const CAKE_KEYWORDS = ['cake', 'birthday', 'anniversary', 'kg', 'flavor', 'chocolate', 'vanilla', 'fondant', 'design', 'custom'];
    const hasCakeKeywords = CAKE_KEYWORDS.some(k => normalizedMessage.toLowerCase().includes(k));

    if (isYes || hasCakeKeywords) {
      logger.info(`User confirmed image is for custom cake: "${messageText}"`);
      if (session.custom_cake_context.image_url) {
        // Save the confirmation message before processing
        await saveIncomingMessage(session.id, originalMessage);

        await processCustomCakeWithIntervention(
          businessId,
          session.id,
          customer.id,
          phone,
          session.custom_cake_context.image_url
        );
        return null; // Handled by intervention
      }
    }

    if (isNo) {
      logger.info(`User said image is NOT for custom cake: "${messageText}"`);
      await clearSessionCustomCakeContext(session.id);
      // Message will be saved later in normal AI processing flow
      // Continue to normal AI processing
    }
  }

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
      await saveIncomingMessage(session.id, originalMessage);

      // Check if there are pending addons to ask about (stored when custom text was first asked)
      const pendingAddonsAfterSkip = pendingAddonSelectionMap.get(session.id);
      if (pendingAddonsAfterSkip && pendingAddonsAfterSkip.itemId === pendingCustomText.itemId) {
        // Ask about addons now
        const addonsMessage = formatAddonsForCustomer(pendingAddonsAfterSkip.addons);
        const skipWithAddons = `${t('customText.skipped', lang).split('!')[0]}!\n\n${addonsMessage}`;
        await saveOutgoingMessage(session.id, skipWithAddons);
        return skipWithAddons;
      }

      const skipReply = t('customText.skipped', lang);
      await saveOutgoingMessage(session.id, skipReply);
      return skipReply;
    }

    if (looksLikeNewOrder) {
      // User wants to order something else, clear pending and continue to AI
      logger.info(`Input "${messageText}" looks like a new order, clearing pending custom text`);
      pendingCustomTextMap.delete(session.id);
      // Fall through to AI processing
    } else {
      // Use AI to classify if this is valid custom text or a question
      // This handles any language (English, Malayalam, Manglish) and phrasing
      const classification = await classifyCustomTextResponse(originalMessage, pendingCustomText.prompt);

      if (classification.isQuestion) {
        // User is asking a question (e.g., "How much", "rate ethra")
        // Don't save as custom text, don't clear pending - pass to main AI to answer
        // Pending will remain so after AI answers, user can still provide the text
        logger.info(`Custom text response is a question: "${originalMessage}" - passing to AI`);
        isCustomTextQuestion = true; // Flag to skip pendingAddon check
        await saveIncomingMessage(session.id, originalMessage);
        // Fall through to AI processing (don't return here)
      } else if (classification.isAffirmation) {
        // User said just "yes"/"ok" - they want to provide text but haven't yet
        // Keep pending state, ask them for the actual text
        logger.info(`Custom text affirmation detected: "${originalMessage}" - asking for actual text`);
        await saveIncomingMessage(session.id, originalMessage);
        const askForTextReply = t('customText.affirmationPrompt', lang);
        await saveOutgoingMessage(session.id, askForTextReply);
        return askForTextReply;
      } else if (!classification.isValidText) {
        // AI detected a skip (e.g., "no", "nothing", "venda")
        logger.info(`AI detected skip for custom text: "${originalMessage}"`);
        pendingCustomTextMap.delete(session.id);
        await saveIncomingMessage(session.id, originalMessage);

        // Check for pending addons
        const pendingAddonsAfterSkip = pendingAddonSelectionMap.get(session.id);
        if (pendingAddonsAfterSkip && pendingAddonsAfterSkip.itemId === pendingCustomText.itemId) {
          // Ask about addons now
          const addonsMessage = formatAddonsForCustomer(pendingAddonsAfterSkip.addons);
          const skipWithAddons = `${t('customText.skipped', lang).split('!')[0]}!\n\n${addonsMessage}`;
          await saveOutgoingMessage(session.id, skipWithAddons);
          return skipWithAddons;
        }

        const skipReply = t('customText.skipped', lang);
        await saveOutgoingMessage(session.id, skipReply);
        return skipReply;
      } else {
        // Valid custom text - save the AI-cleaned version
        const cleanedText = classification.cleanedText || originalMessage;

        logger.info(`Saving custom text response for item ${pendingCustomText.itemId}: "${cleanedText}"`);
        await updateSessionItemCustomText(pendingCustomText.itemId, cleanedText);
        pendingCustomTextMap.delete(session.id);

        // Save incoming message
        await saveIncomingMessage(session.id, originalMessage);

        // Check if there are pending addons to ask about (stored when custom text was first asked)
        const pendingAddonsAfterText = pendingAddonSelectionMap.get(session.id);
        if (pendingAddonsAfterText && pendingAddonsAfterText.itemId === pendingCustomText.itemId) {
          // Ask about addons now
          const addonsMessage = formatAddonsForCustomer(pendingAddonsAfterText.addons);
          const confirmWithAddons = `${t('customText.saved', lang, { text: cleanedText })}\n\n${addonsMessage}`;
          await saveOutgoingMessage(session.id, confirmWithAddons);
          return confirmWithAddons;
        }

        // No addons to ask about
        const confirmReply = t('customText.savedAnythingElse', lang, { text: cleanedText });
        await saveOutgoingMessage(session.id, confirmReply);
        return confirmReply;
      }
    }
  }

  // Check for pending addon selection (e.g., user replied "1" or "candle" after addon suggestion)
  // Skip if user asked a question during custom text prompt (let AI answer instead)
  const pendingAddon = pendingAddonSelectionMap.get(session.id);
  if (pendingAddon && !isCustomTextQuestion) {
    const normalizedInput = messageText.toLowerCase().trim();

    // Check if user wants to skip addons
    if (['no', 'no thanks', 'skip', 'none', 'nope', 'nothing'].some(s => normalizedInput === s || normalizedInput.startsWith(s + ' '))) {
      logger.info(`Customer declined addons for item ${pendingAddon.itemId}`);
      pendingAddonSelectionMap.delete(session.id);

      await saveIncomingMessage(session.id, originalMessage);
      const skipReply = t('addons.declined', lang);
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
        await saveIncomingMessage(session.id, originalMessage);
        const addonNames = pendingAddon.addons.map((a, i) => `${i + 1}. ${a.name}`).join('\n');
        const customTextReply = t('customText.savedWithAddonPrompt', lang, { text: customTextContent, options: addonNames });
        await saveOutgoingMessage(session.id, customTextReply);
        return customTextReply;
      } else {
        // Ask for the custom text
        await saveIncomingMessage(session.id, originalMessage);
        const askTextReply = t('customText.askPrompt', lang);
        await saveOutgoingMessage(session.id, askTextReply);
        // Set pending custom text for next message
        pendingCustomTextMap.set(session.id, {
          itemId: pendingAddon.itemId,
          prompt: t('customText.askPrompt', lang),
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

      await saveIncomingMessage(session.id, originalMessage);
      const addonReply = selectedAddons.length === 1
        ? t('addons.added', lang, { addon: addedNames[0] })
        : t('addons.addedMultiple', lang, { addons: addedNames.join(', ') });
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
      await saveIncomingMessage(session.id, originalMessage);

      const addonNames = pendingAddon.addons.map((a, i) => `${i + 1}. ${a.name}`).join('\n');
      const hintReply = t('addons.hint', lang, { options: addonNames });
      await saveOutgoingMessage(session.id, hintReply);
      return hintReply;
    }
  }

  // Get outlets for fulfillment
  const outlets = businessId ? await getBusinessOutlets(businessId) : [];
  logger.info(`Outlets loaded: ${outlets.length}`);

  // Check if session needs time (has fulfillment type but no time) and user typed a time-like message
  const sessionForTimeCheck = await getSessionWithItems(session.id);
  if (sessionForTimeCheck) {
    const needsDeliveryTime = sessionForTimeCheck.fulfillment_type === 'delivery' &&
      sessionForTimeCheck.delivery_address && !sessionForTimeCheck.delivery_time;
    const needsPickupTime = sessionForTimeCheck.fulfillment_type === 'takeaway' &&
      sessionForTimeCheck.pickup_outlet_id && !sessionForTimeCheck.pickup_time;

    if (needsDeliveryTime || needsPickupTime) {
      // Check if message looks like a time input
      const looksLikeTime = /\d{1,2}(?:[:\d]{2})?\s*(?:am|pm)|morning|evening|afternoon|today|tomorrow|nale|innu/i.test(messageText);

      if (looksLikeTime) {
        logger.info(`Session needs time, parsing: "${messageText}"`);
        const parsedTime = parseDeliveryTime(messageText, businessTimezone);

        if (parsedTime) {
          await saveIncomingMessage(session.id, originalMessage);

          // Validate against operating hours
          if (needsPickupTime && sessionForTimeCheck.pickup_outlet_id) {
            const selectedOutlet = outlets.find(o => o.id === sessionForTimeCheck.pickup_outlet_id);
            if (selectedOutlet) {
              const validation = validateOperatingHours(parsedTime, selectedOutlet, businessTimezone);
              if (!validation.valid) {
                const reason = t(`time.${validation.reasonKey}` as any, lang, validation.reasonValues);
                logger.warn(`Pickup time ${parsedTime} rejected: ${reason}`);
                const errorMsg = t('time.outsideHours', lang, { reason });
                await saveOutgoingMessage(session.id, errorMsg);
                return errorMsg;
              }
            }
          } else if (needsDeliveryTime && outlets.length > 0) {
            // For delivery, validate against the first/primary outlet's hours
            const primaryOutlet = outlets[0];
            const validation = validateOperatingHours(parsedTime, primaryOutlet, businessTimezone);
            if (!validation.valid) {
              const reason = t(`time.${validation.reasonKey}` as any, lang, validation.reasonValues);
              logger.warn(`Delivery time ${parsedTime} rejected: ${reason}`);
              const errorMsg = t('time.outsideHours', lang, { reason });
              await saveOutgoingMessage(session.id, errorMsg);
              return errorMsg;
            }
          }

          // ============================================ 
          // URGENT ORDER CHECK (before custom cake)
          // ============================================
          // Check if time is within minimum_wait_minutes (urgent order requiring admin approval)
          const minimumWaitMinutes = (business as any)?.minimum_wait_minutes;
          if (minimumWaitMinutes && minimumWaitMinutes > 0) {
            const requestedDate = new Date(parsedTime);
            const now = new Date();
            const diffMinutes = (requestedDate.getTime() - now.getTime()) / (1000 * 60);

            // Only trigger for future times within minimum_wait_minutes
            if (diffMinutes > 0 && diffMinutes < minimumWaitMinutes) {
              const fulfillmentType = needsDeliveryTime ? 'delivery' : 'takeaway';
              logger.info(`🚨 Urgent order detected: ${parsedTime} is ${Math.round(diffMinutes)} min away (min wait: ${minimumWaitMinutes})`);

              // Skip if custom cake order (they have their own confirmation flow)
              const acceptedQuoteForUrgent = await getAcceptedQuoteForSession(session.id);
              if (!acceptedQuoteForUrgent) {
                // Create urgent_delivery intervention
                const urgentIntervention = await createIntervention(
                  businessId,
                  session.id,
                  customer.id,
                  'urgent_delivery',
                  {
                    requestedTime: parsedTime,
                    fulfillmentType,
                    minimumWaitMinutes,
                    minutesUntilRequested: Math.round(diffMinutes),
                    deliveryAddress: sessionForTimeCheck.delivery_address,
                    outletId: sessionForTimeCheck.pickup_outlet_id,
                    phone,
                  }
                );

                if (urgentIntervention) {
                  // Pause AI
                  await pauseAI(session.id, 'Urgent order - awaiting admin confirmation');
                  // Emit socket event
                  emitInterventionCreated(businessId, urgentIntervention);

                  // Format time for display
                  const formattedTime = new Date(parsedTime).toLocaleString('en-IN', { timeZone: businessTimezone, dateStyle: 'medium', timeStyle: 'short' });
                  const typeLabel = fulfillmentType === 'delivery' ? t('fulfillment.deliveryBtn', lang) : t('fulfillment.takeawayBtn', lang);

                  const waitingMsg = t('urgentOrder.waitingConfirmation', lang, { type: typeLabel, time: formattedTime });
                  await saveOutgoingMessage(session.id, waitingMsg);
                  return waitingMsg;
                }
              }
            }
          }

          // ============================================ 
          // CUSTOM CAKE TIME CONFIRMATION FLOW
          // ============================================ 
          // Check if this is a custom cake order that needs admin time confirmation
          const acceptedQuote = await getAcceptedQuoteForSession(session.id);

          if (acceptedQuote && !acceptedQuote.time_confirmed) {
            // This is a custom cake order - time needs admin confirmation
            const fulfillmentType = needsDeliveryTime ? 'delivery' : 'takeaway';
            logger.info(`🎂 Custom cake time request: ${parsedTime} (${fulfillmentType})`);

            // Save time to quote (pending confirmation)
            await updateQuoteTimeRequest(acceptedQuote.id, parsedTime, fulfillmentType);

            // Also save to session for display purposes
            if (needsDeliveryTime) {
              await updateSessionDeliveryInfo(session.id, {
                address: sessionForTimeCheck.delivery_address!,
                time: parsedTime,
              });
            } else {
              await updateSessionPickupInfo(session.id, {
                outlet_id: sessionForTimeCheck.pickup_outlet_id!,
                time: parsedTime,
              });
            }

            // Create intervention for admin dashboard
            const timeIntervention = await createIntervention(
              businessId,
              session.id,
              customer.id,
              'custom_cake_time_confirmation',
              {
                quoteId: acceptedQuote.id,
                requestedTime: parsedTime,
                fulfillmentType: fulfillmentType,
                phone,
              }
            );

            if (timeIntervention) {
              // Pause AI for admin to handle
              await pauseAI(session.id, 'Custom cake time confirmation pending');
              // Emit WebSocket event for admin dashboard
              emitInterventionCreated(businessId, timeIntervention);
            }

            // Notify admin about time confirmation request
            await notifyBusinessAdmin(businessId, {
              type: 'cake_time_confirmation',
              customerId: customer.id,
              phone,
              message: `Custom cake time confirmation needed: ${parsedTime} (${fulfillmentType})`,
              quoteId: acceptedQuote.id,
            });

            // Tell customer to wait for confirmation
            const timeConfirmMsg = t('customCake.timeConfirmRequest', lang, {
              type: fulfillmentType,
              time: parsedTime,
            });
            await saveOutgoingMessage(session.id, timeConfirmMsg);
            return timeConfirmMsg;
          }

          // Normal flow - save time and show confirmation
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
            ctaMessage: t('orderSummary.reviewPrompt', lang),
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
    await saveIncomingMessage(session.id, originalMessage);
    return null; // Return null to indicate no AI response
  }

  // Get session with items (for duplicate prevention)
  const sessionWithItems = await getSessionWithItems(session.id);
  let existingItems = sessionWithItems?.items || [];

  // Check for active order (customer may be asking about their order)
  const activeOrder = await getCustomerActiveOrder(customer.id, businessId);
  if (activeOrder) {
    logger.info(`Customer ${phone} has active order: ${activeOrder.order_number} (status: ${activeOrder.status})`);
  }

  // ============================================
  // CUSTOM CAKE QUOTE ACCEPTANCE HANDLER
  // ============================================ 
  // Check if customer is accepting a sent quote (before AI processing)
  // Flexible matching - allows phrases like "Ooh.. Okay", "Yes please", "please proceed"
  const acceptancePatterns = [
    /\b(okay|ok)\b/i,                          // "Ooh.. Okay", "Ok"
    /\b(yes|yeah|yep|yup)\b/i,                 // "Yes", "Yes please"
    /\b(sure|confirm|accept|agreed)\b/i,       // "Sure", "I accept"
    /\bproceed\b/i,                            // "Please proceed", "No please proceed"
    /\bgo\s*ahead\b/i,                         // "Go ahead"
    /\bsheri\b/i,                              // Malayalam "sheri" = okay
  ];
  const isAcceptMessage = acceptancePatterns.some(pattern => pattern.test(messageText.trim()));

  if (isAcceptMessage) {
    // IMPORTANT: Skip quote acceptance if fulfillment is already complete
    // This means user is saying "Yes" to confirm their ORDER, not to accept a quote
    const fulfillmentComplete = sessionWithItems?.fulfillment_type &&
      (sessionWithItems?.delivery_address || sessionWithItems?.pickup_outlet_id);

    if (fulfillmentComplete && existingItems.length > 0) {
      logger.info(`Quote acceptance skipped - fulfillment complete, this is order confirmation`);
      // Let the code continue to AI processing and confirm_order intent handling
    } else {
      // Check if there's a sent quote waiting for acceptance
      const sentQuote = await getSentQuoteForSession(session.id);
      logger.info(`Quote acceptance check - message: "${messageText}", sessionId: ${session.id}, sentQuote: ${sentQuote?.id || 'none'}`);


      if (sentQuote) {
        logger.info(`🎂 Customer accepting custom cake quote: ${sentQuote.id}`);

        // Mark quote as accepted
        const acceptedQuote = await markQuoteAsAccepted(sentQuote.id);

        if (acceptedQuote) {
          const finalPrice = acceptedQuote.admin_final_price ?? acceptedQuote.suggested_price ?? 0;
          const cakeFlavor = acceptedQuote.ai_analysis?.detected_flavor || acceptedQuote.customer_flavor || 'Custom';
          const cakeWeight = acceptedQuote.customer_weight ||
            (acceptedQuote.ai_analysis?.detected_weight_grams ? `${acceptedQuote.ai_analysis.detected_weight_grams}g` : '1kg');

          // Add custom cake to cart
          const customCakeItem = await saveOrderItem(session.id, {
            name: `Custom ${cakeFlavor} Cake`,
            size_or_weight: cakeWeight,
            quantity: 1,
            notes: 'Custom designed cake (quote accepted)',
          }, businessId);

          // Update the item with admin-confirmed price directly
          const { supabase } = await import('../config/database');
          await supabase
            .from('session_items')
            .update({ unit_price: finalPrice })
            .eq('id', customCakeItem.id);

          logger.info(`✅ Custom cake added to cart: ${customCakeItem.id}, price: ₹${finalPrice}`);

          // Store last item for addons
          lastAddedItemMap.set(session.id, customCakeItem.id);

          // Refresh existing items
          const updatedSession = await getSessionWithItems(session.id);
          existingItems = updatedSession?.items || [];

          // Save incoming message
          await saveIncomingMessage(session.id, originalMessage);

          // Generate summary and ask for fulfillment
          const summary = await generateOrderSummary(session.id, { includeCta: false, timezone: business?.timezone || 'Asia/Kolkata' });

          let quoteAcceptedReply: string;
          if (business?.supports_delivery && business?.supports_takeaway) {
            quoteAcceptedReply = t('customCake.addedThenAskFulfillment', lang, { summary });
            await saveOutgoingMessage(session.id, quoteAcceptedReply);
            await sendReplyButtons(phone, quoteAcceptedReply, [
              { id: 'delivery', title: t('fulfillment.deliveryBtn', lang) },
              { id: 'takeaway', title: t('fulfillment.takeawayBtn', lang) },
            ]);
            return null;
          } else if (business?.supports_delivery) {
            quoteAcceptedReply = t('customCake.addedThenAskDelivery', lang, { summary });
          } else {
            quoteAcceptedReply = t('customCake.addedThenAskPickup', lang, { summary });
            if (outlets.length > 0) {
              quoteAcceptedReply += '\n\n' + formatOutletsForCustomer(outlets);
            }
          }

          await saveOutgoingMessage(session.id, quoteAcceptedReply);
          return quoteAcceptedReply;
        }
      }
    } // Close else block for fulfillment check
  }

  // ============================================ 
  // CUSTOM CAKE PRICE/WEIGHT CHANGE DETECTION
  // ============================================ 
  // If customer has an accepted/sent quote and asks about different weight/price,
  // create a revision quote for admin review instead of letting AI calculate
  const existingQuoteForRevision = await getAcceptedQuoteForSession(session.id) || await getSentQuoteForSession(session.id);

  if (existingQuoteForRevision && businessId) {
    // Patterns that indicate price/weight inquiry or change request
    // Malayalam: "ethra" = how much, "rate" = rate/price, "vila" = price
    // English: "price", "rate", "cost", "how much"
    // Weight patterns: "2kg", "2 kg", "3kg", "1.5kg", etc.
    const priceInquiryPattern = /(?:rate|price|cost|ethra|vila|how much|enna vila|enthu vila)/i;
    const weightPattern = /(\d+(?:\.\d+)?)\s*(?:kg|kilo|kilogram)/i;
    const weightChangePattern = /(?:make it|change to|want|need|update to|change weight|different weight)\s*(\d+(?:\.\d+)?)\s*(?:kg|kilo)?/i;

    const hasPriceInquiry = priceInquiryPattern.test(messageText);
    const weightMatch = messageText.match(weightPattern);
    const weightChangeMatch = messageText.match(weightChangePattern);

    // Check if message mentions a weight different from current quote
    const currentWeight = existingQuoteForRevision.customer_weight || '1kg';
    const currentWeightNum = parseFloat(currentWeight.replace(/[^\d.]/g, '')) || 1;

    let requestedWeight: string | null = null;
    let requestedWeightNum: number | null = null;

    if (weightMatch) {
      requestedWeightNum = parseFloat(weightMatch[1]);
      requestedWeight = `${requestedWeightNum}kg`;
    } else if (weightChangeMatch) {
      requestedWeightNum = parseFloat(weightChangeMatch[1]);
      requestedWeight = `${requestedWeightNum}kg`;
    }

    // If asking about different weight (price inquiry or change request)
    if (requestedWeight && requestedWeightNum && requestedWeightNum !== currentWeightNum) {
      logger.info(`🎂 Custom cake weight/price change detected: ${currentWeight} → ${requestedWeight}`);

      await saveIncomingMessage(session.id, originalMessage);

      // Create a revision quote for admin to review
      try {
        const revisionQuote = await createQuoteRevision(
          existingQuoteForRevision,
          requestedWeight,
          `Customer requested ${requestedWeight} (was ${currentWeight})`
        );

        // Notify admin about the revision request
        await notifyBusinessAdmin(businessId, {
          type: 'cake_quote_revision',
          customerId: customer.id,
          phone,
          message: `Custom cake quote revision needed: ${currentWeight} → ${requestedWeight}`,
          quoteId: revisionQuote.id,
        });

        const revisionMsg = t('customCake.revisionQuote', lang, { weight: requestedWeight });
        await saveOutgoingMessage(session.id, revisionMsg);
        return revisionMsg;
      } catch (error) {
        logger.error('Failed to create quote revision', error);
        // Fall through to AI processing if revision creation fails
      }
    }

    // If just asking about price without specific weight change (e.g., "how much", "rate ethra")
    // and there's already a pending quote, remind them to wait
    if (hasPriceInquiry && !requestedWeight) {
      const pendingQuote = await getPendingQuoteForSession(session.id);
      if (pendingQuote) {
        await saveIncomingMessage(session.id, originalMessage);
        const waitMsg = t('customCake.quoteWaiting', lang);
        await saveOutgoingMessage(session.id, waitMsg);
        return waitMsg;
      }
    }
  }

  // Get recent message history
  const messageHistory = await getRecentMessages(session.id);

  // Check if this is the first message in the session (for welcome message)
  const isFirstMessage = messageHistory.length === 0;

  // Get menu for AI context
  let menuItems;
  let menuCategories;
  let amenities;
  if (businessId) {
    menuItems = await getMenuItems(businessId);
    menuCategories = await getMenuCategories(businessId);
    amenities = await getBusinessAmenities(businessId);
    logger.info(`Menu loaded: ${menuItems?.length || 0} items, ${menuCategories?.length || 0} categories, ${amenities?.length || 0} amenities`);
  } else {
    logger.warn('No business found - AI will have no menu context!');
  }

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
    amenities,
    customerLanguage: lang, // i18n: Pass customer's preferred language to AI
    // Active order context for post-order inquiries
    activeOrder: activeOrder ? {
      order_number: activeOrder.order_number,
      status: activeOrder.status,
      total_amount: activeOrder.total_amount,
      fulfillment_type: activeOrder.fulfillment_type,
      created_at: activeOrder.created_at,
    } : null,
  };

  logger.debug(`AI context fulfillment: type=${latestSessionData.fulfillment_type}, addr=${latestSessionData.delivery_address}, outlet=${latestSessionData.pickup_outlet_id}`);

  // ============================================
  // HANDLE: Awaiting full address after WhatsApp location shared
  // ============================================
  // Check if session has lat/long but no address (waiting for full address input)
  const isAwaitingFullAddress = latestSessionData.fulfillment_type === 'delivery' &&
    latestSessionData.delivery_latitude &&
    latestSessionData.delivery_longitude &&
    !latestSessionData.delivery_address;

  if (isAwaitingFullAddress) {
    logger.info(`[ADDR] Session awaiting full address. Validating user input: "${messageText}"`);

    // Validate if message looks like a valid address (not an order or question)
    const sanitizedAddress = messageText.trim();
    const isValidAddress = validateAddressInput(sanitizedAddress);

    if (isValidAddress) {
      logger.info(`[ADDR] Valid address detected: "${sanitizedAddress}"`);

      // Save the address to session
      await updateSessionDeliveryInfo(session.id, {
        address: sanitizedAddress,
        // Keep existing lat/long
      });

      // Save incoming message
      await saveIncomingMessage(session.id, originalMessage);

      // Ask for delivery date
      const datePrompt = t('fulfillment.locationSavedThenAskDate', lang);
      await saveOutgoingMessage(session.id, datePrompt);
      await sendReplyButtons(phone, datePrompt, [
        { id: 'date_today_delivery', title: `📅 ${t('buttons.today', lang)}` },
        { id: 'date_tomorrow_delivery', title: `📅 ${t('buttons.tomorrow', lang)}` },
        { id: 'date_other_delivery', title: `📅 ${t('buttons.other', lang)}` },
      ]);

      logger.info(`[ADDR] Address saved, asking for date`);
      return null; // Early return - don't process with AI
    } else {
      logger.info(`[ADDR] Input doesn't look like address, proceeding to AI: "${sanitizedAddress}"`);
      // Not a valid address - let AI process (could be order, question, etc.)
    }
  }

  // Process with AI
  const aiResponse = await processMessageWithAI(
    messageText,
    messageHistory,
    session,
    aiContext
  );

  // Save incoming message (use original, not normalized, to preserve customer's actual input)
  await saveIncomingMessage(session.id, originalMessage);

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

  // ============================================ 
  // FALLBACK: Custom cake quote when AI adds item but menu validation fails
  // ============================================ 
  // If AI tried to add a custom cake but it was rejected as "item_not_available",
  // check if there's a sent quote and add the custom cake from the quote
  if (intentToProcess === 'item_not_available') {
    const sentQuote = await getSentQuoteForSession(session.id);
    if (sentQuote) {
      logger.info(`🎂 Fallback: Found sent quote ${sentQuote.id} for item_not_available - adding custom cake`);

      // Mark quote as accepted
      const acceptedQuote = await markQuoteAsAccepted(sentQuote.id);

      if (acceptedQuote) {
        const finalPrice = acceptedQuote.admin_final_price ?? acceptedQuote.suggested_price ?? 0;
        const cakeFlavor = acceptedQuote.ai_analysis?.detected_flavor || acceptedQuote.customer_flavor || 'Custom';
        const cakeWeight = acceptedQuote.customer_weight ||
          (acceptedQuote.ai_analysis?.detected_weight_grams ? `${acceptedQuote.ai_analysis.detected_weight_grams}g` : '1kg');

        // Add custom cake to cart
        const customCakeItem = await saveOrderItem(session.id, {
          name: `Custom ${cakeFlavor} Cake`,
          size_or_weight: cakeWeight,
          quantity: 1,
          notes: 'Custom designed cake (quote accepted)',
        }, businessId);

        // Update with admin-confirmed price
        const { supabase } = await import('../config/database');
        await supabase
          .from('session_items')
          .update({ unit_price: finalPrice })
          .eq('id', customCakeItem.id);

        logger.info(`✅ Custom cake added via fallback: ${customCakeItem.id}, price: ₹${finalPrice}`);
        lastAddedItemMap.set(session.id, customCakeItem.id);

        // Generate summary and ask for fulfillment
        const summary = await generateOrderSummary(session.id, { includeCta: false, timezone: business?.timezone || 'Asia/Kolkata' });

        let fallbackReply: string;
        if (business?.supports_delivery && business?.supports_takeaway) {
          fallbackReply = t('customCake.addedThenAskFulfillment', lang, { summary });
          await saveOutgoingMessage(session.id, fallbackReply);
          await sendReplyButtons(phone, fallbackReply, [
            { id: 'delivery', title: t('fulfillment.deliveryBtn', lang) },
            { id: 'takeaway', title: t('fulfillment.takeawayBtn', lang) },
          ]);
          return null;
        } else if (business?.supports_delivery) {
          fallbackReply = t('customCake.addedThenAskDelivery', lang, { summary });
        } else {
          fallbackReply = t('customCake.addedThenAskPickup', lang, { summary });
          if (outlets.length > 0) {
            fallbackReply += '\n\n' + formatOutletsForCustomer(outlets);
          }
        }
        await saveOutgoingMessage(session.id, fallbackReply);
        return fallbackReply;
      }
    }
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
          replyMessage = t('cart.addedMultiple', lang, { items: addedItemNames.map((n, i) => `${i + 1}. ${n}`).join('\n') });
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
                    // i18n: Use translated "Added to cart" message, keep custom_text_prompt as-is (business sets it)
                    replyMessage = `${t('cart.added', lang, { item: itemDesc })}\n\n${notePrefix}${category.custom_text_prompt}`;
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
            replyMessage = t('error.cartAddFailed', lang, {
              support: supportPhone ? t('error.contactSupport', lang, { phone: supportPhone }) : '',
            });
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
        ctaMessage: t('orderSummary.confirmItems', lang),
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
          replyMessage = t('addons.noItemForAddon', lang);
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
                ) || null;
              }

              if (selectedAddon) {
                await addAddonToSessionItem(lastItemId, selectedAddon.id, aiResponse.addon.quantity || 1);
                logger.info(`Add-on added: ${selectedAddon.name} to item ${lastItemId}`);

                // Update reply to confirm
                if (!replyMessage.includes('Added')) {
                  replyMessage = t('addons.added', lang, { addon: `${selectedAddon.name}${selectedAddon.price ? ` (₹${selectedAddon.price})` : ' (FREE)'}` }) + `! ${replyMessage}`;
                }
              } else {
                logger.warn(`Add-on not found: ${aiResponse.addon.addon_name}`);
                replyMessage = t('addons.notAvailable', lang);
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
          replyMessage = t('addons.removed', lang, { addonName: removeResult.addonName ?? '', itemName: removeResult.itemName ?? '' });

          // Clear pending addon selection if exists
          pendingAddonSelectionMap.delete(session.id);
        } else {
          logger.warn(`Failed to remove addon: ${aiResponse.addon.addon_name}`);
          replyMessage = t('addons.notFound', lang, { addon: aiResponse.addon.addon_name });
        }
      } else {
        replyMessage = t('addons.whichRemove', lang);
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
          replyMessage = t('customText.updated', lang, { item: itemToUpdate.item_name, text: newCustomText });
          // Clear pending custom text only after successfully updating
          pendingCustomTextMap.delete(session.id);
        } else {
          logger.warn('No item found to update custom text');
          replyMessage = t('customText.updateFailedNoItem', lang);
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
            replyMessage = t('customText.clarifyItem', lang, { items: cakeList });
            // Don't set pending yet - wait for them to specify which cake
            break;
          }

          // User mentioned specific item
          if (itemToUpdate) {
            pendingCustomTextMap.set(session.id, {
              itemId: itemToUpdate.id,
              prompt: t('customText.askPromptForItem', lang, { item: itemToUpdate.item_name }),
            });
            replyMessage = t('customText.askPromptForItem', lang, { item: itemToUpdate.item_name });
          } else {
            replyMessage = t('customText.addFailedNoItem', lang);
          }
        } else {
          // Single item or no ambiguity
          const itemToUpdate = findTargetItemForCustomText();
          if (itemToUpdate) {
            pendingCustomTextMap.set(session.id, {
              itemId: itemToUpdate.id,
              prompt: t('customText.askPromptForItem', lang, { item: itemToUpdate.item_name }),
            });
            replyMessage = t('customText.askPromptForItem', lang, { item: itemToUpdate.item_name });
          } else {
            replyMessage = t('customText.updateFailedNoItem', lang);
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
        replyMessage = t('customText.removed', lang, { item: itemWithText.item_name });
      } else {
        logger.warn('No item found with custom text to remove');
        replyMessage = t('customText.removeFailedNoText', lang);
      }
      // Clear pending custom text if exists
      pendingCustomTextMap.delete(session.id);
      break;

    case 'requires_intervention':
      // Generic intervention triggers (urgent delivery, out or radius, etc.)
      logger.info(`🚨 Intervention triggered: ${aiResponse.analysis?.reason || 'Unknown reason'}`);

      // Create intervention request
      const intervention = await createIntervention(
        businessId,
        session.id,
        customer.id,
        'other', // Could be refined based on analysis
        {
          message: messageText,
          reason: aiResponse.analysis?.reason
        },
        aiResponse.analysis
      );

      if (intervention) {
        // Pause AI to let admin handle it
        await pauseAI(session.id, 'System Intervention');

        // Notify admins via socket
        emitInterventionCreated(businessId, intervention);

        // Notify generic admin via notification service (push/email if configured)
        await notifyBusinessAdmin(businessId, {
          type: 'intervention_required',
          customerId: customer.id,
          phone,
          message: `Admin intervention needed: ${aiResponse.analysis?.reason || messageText}`,
        });

        // Reply to customer
        replyMessage = t('intervention.adminWillContact', lang); // Need to add this translation key or use hardcoded
        if (!replyMessage || replyMessage.includes('intervention.')) {
          replyMessage = "An admin will review your request and contact you shortly.";
        }
      } else {
        replyMessage = t('error.generic', lang);
      }
      break;

    case 'custom_cake_inquiry':
      // Customer asking about custom/personalized cake design
      if (business && (business as any).custom_cake_enabled) {
        logger.info('Custom cake inquiry - triggering intervention');

        // Extract weight/flavor if present in message
        const extractedWeight = messageText.match(/(\d+(?:\.\d+)?\s*(?:kg|g|lb|pound)s?)/i)?.[1];
        const extractedFlavor = messageText.match(/(chocolate|vanilla|strawberry|red velvet|butterscotch|black forest|truffle)/i)?.[0];

        // DON'T create intervention yet - wait for image
        // DON'T pause AI - keep conversation flowing

        // Set context flag
        await updateSessionCustomCakeContext(session.id, {
          awaiting_image: true,
          inquiry_type: 'text_first',
          weight: extractedWeight,
          flavor: extractedFlavor,
        });

        // Ask for image
        replyMessage = t('customCake.askForImage', lang);
        if (!replyMessage || replyMessage.includes('customCake.')) {
          replyMessage = "Yes! Please share an image of the design you'd like, and let us know the weight and flavor.";
        }


      } else {
        // Custom cakes not enabled
        const supportPhone = business?.customer_support_phone;
        replyMessage = supportPhone
          ? t('customCake.contactSupport', lang, { phone: supportPhone })
          : "Sorry, we don't do custom cakes at the moment.";
      }
      break;

    case 'show_menu':
      if (business?.id) {
        const menuSlug = (aiResponse as any).menu_slug;

        if (menuSlug) {
          // Specific menu requested
          const specificConfig = await getMenuPdfConfigBySlug(business.id, menuSlug);
          if (specificConfig?.pdf_url) {
            await sendDocument(phone, specificConfig.pdf_url, `${specificConfig.name}.pdf`, specificConfig.name);
            await saveOutgoingMessage(session.id, `[Sent ${specificConfig.name} PDF]`);
            return null; // Don't send another message
          }
        }

        // Get all active menu PDF configs
        const menuConfigs = await getActiveMenuPdfConfigs(business.id);

        if (menuConfigs.length > 0) {
          // Send all menu PDFs
          for (const config of menuConfigs) {
            if (config.pdf_url) {
              await sendDocument(
                phone,
                config.pdf_url,
                `${config.name}.pdf`,
                config.name // Caption = menu name
              );
            }
          }
          await saveOutgoingMessage(session.id, `[Sent ${menuConfigs.length} menu PDF(s)]`);
          return null;
        } else {
          // Fallback to full menu PDF if no configs
          const pdfExists = await menuPdfExists(business.id);
          if (pdfExists) {
            const pdfUrl = getMenuPdfUrl(business.id);
            const menuCaption = t('menu.pdfCaption', lang);
            await sendDocument(phone, pdfUrl, `${business.name || 'Menu'}.pdf`, menuCaption);
            await saveOutgoingMessage(session.id, `[Menu PDF sent] ${menuCaption}`);
            return null;
          }
        }
      }
      // Fallback: Send interactive category list for large menus, text for small menus
      if (menuItems && menuCategories && menuItems.length > 0) {
        if (menuItems.length > 30 && menuCategories.length > 5) {
          // Large menu: Use interactive list with smart groupings
          const categorySections = buildCategoryListSections(menuCategories);
          if (categorySections.length > 0) {
            const menuIntro = t('menu.welcome', lang, { businessName: business?.name || t('menu.ourMenu', lang) });
            await saveOutgoingMessage(session.id, menuIntro);
            await sendInteractiveListMessage(
              phone,
              t('menu.ourMenu', lang),
              menuIntro,
              t('menu.browseBtn', lang),
              categorySections
            );
            return null; // Don't send another message
          }
        }
        // Small menu or fallback: use text format
        replyMessage = formatMenuForCustomer(menuItems, menuCategories);
      } else {
        replyMessage = t('menu.fallback', lang);
      }
      break;

    case 'ready_for_checkout':
      // Generate and send order summary - but validate cart first
      const checkoutSession = await getSessionWithItems(session.id);
      if (!checkoutSession || checkoutSession.items.length === 0) {
        logger.warn(`⚠️ READY_FOR_CHECKOUT but cart is EMPTY! Session: ${session.id}`);
        replyMessage = t('cart.empty', lang);
        break;
      }
      // Check if fulfillment info is already complete (user added more items after providing address)
      const hasFulfillmentInfo = session.fulfillment_type && (
        (session.fulfillment_type === 'delivery' && session.delivery_address) ||
        (session.fulfillment_type === 'takeaway' && session.pickup_outlet_id)
      );

      if (hasFulfillmentInfo) {
        // Fulfillment already collected - show final summary and ask for confirmation
        const finalSummary = await generateOrderSummary(session.id, { includeCta: true, timezone: businessTimezone });
        replyMessage = finalSummary + '\n\n' + t('order.confirmPrompt', lang);
        break;
      }

      // Show summary and ask for delivery/takeaway directly (no separate item confirmation)
      const summary = await generateOrderSummary(session.id, { includeCta: false, timezone: businessTimezone });
      if (business?.supports_delivery && business?.supports_takeaway) {
        // Use interactive buttons for delivery/takeaway choice
        const askFulfillment = summary + '\n\n' + t('fulfillment.askType', lang);
        await saveOutgoingMessage(session.id, askFulfillment);
        await sendReplyButtons(phone, askFulfillment, [
          { id: 'delivery', title: t('fulfillment.deliveryBtn', lang) },
          { id: 'takeaway', title: t('fulfillment.takeawayBtn', lang) },
        ]);
        return null; // Don't send another message
      } else if (business?.supports_delivery) {
        replyMessage = summary + '\n\n' + t('fulfillment.deliveryPrompt', lang);
      } else {
        // Takeaway only - Use interactive list for outlet selection
        if (outlets.length > 0) {
          await updateSessionFulfillmentType(session.id, 'takeaway');
          const pickupPrompt = summary + '\n\n' + t('fulfillment.pickupPrompt', lang);
          await saveOutgoingMessage(session.id, pickupPrompt);
          await sendInteractiveListMessage(
            phone,
            t('buttons.pickupLocations', lang),
            pickupPrompt,
            t('buttons.chooseLocation', lang),
            [{
              title: t('buttons.availableOutlets', lang),
              rows: outlets.map(o => ({
                id: o.id,
                title: o.outlet_name,
                description: o.address?.substring(0, 72),
              })),
            }]
          );
          return null; // Don't send another message
        } else {
          replyMessage = summary + '\n\n' + t('fulfillment.askPickupTimeGeneric', lang);
        }
      }
      break;

    case 'confirm_items':
      // Legacy support - treat same as ready_for_checkout
      const itemsSession = await getSessionWithItems(session.id);
      if (!itemsSession || itemsSession.items.length === 0) {
        logger.warn(`⚠️ CONFIRM_ITEMS but cart is EMPTY! Session: ${session.id}`);
        replyMessage = t('cart.empty', lang);
        break;
      }
      // Ask for delivery or takeaway
      if (business?.supports_delivery && business?.supports_takeaway) {
        replyMessage = t('fulfillment.askTypeDirect', lang);
      } else if (business?.supports_delivery) {
        replyMessage = t('fulfillment.askAddress', lang);
      } else {
        replyMessage = t('fulfillment.pickupPrompt', lang);
        if (outlets.length > 0) {
          replyMessage += '\n\n' + formatOutletsForCustomer(outlets);
        }
      }
      break;

    case 'ask_fulfillment_type':
      // Ask customer for delivery or takeaway
      if (business?.supports_delivery && business?.supports_takeaway) {
        replyMessage = aiResponse.reply || t('fulfillment.askType', lang);
      } else if (business?.supports_delivery) {
        replyMessage = t('fulfillment.offerDelivery', lang);
      } else {
        replyMessage = t('fulfillment.pickupPrompt', lang);
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
          const addressFromAI = aiResponse.fulfillment.delivery_address;

          // Skip if AI extracted coordinate format (not a real address)
          // Patterns: "Lat: X, Long: Y", "Provided Location (Lat: X", "Location: X, Y", etc.
          const isCoordinateFormat = /^(Lat|Location|Latitude|Provided Location)[\s:(]*-?\d+\.?\d*/i.test(addressFromAI) ||
            /\(Lat[\s:]*-?\d+\.?\d*.*Long[\s:]*-?\d+\.?\d*\)/i.test(addressFromAI) ||
            /Lat[\s:]*-?\d+\.?\d*.*Long[\s:]*-?\d+\.?\d*/i.test(addressFromAI);

          // Skip if session already has lat/long (location was shared via WhatsApp)
          const sessionData = await getSessionWithItems(session.id);
          const hasLocationAlready = sessionData?.delivery_latitude && sessionData?.delivery_longitude;

          if (isCoordinateFormat) {
            logger.info(`Skipping coordinate format address from AI: ${addressFromAI}`);
            // Still try to save time if provided
            let deliveryTime = aiResponse.fulfillment.delivery_time
              ? parseDeliveryTime(aiResponse.fulfillment.delivery_time, businessTimezone)
              : null;
            if (deliveryTime) {
              await updateSessionDeliveryInfo(session.id, { time: deliveryTime });
              logger.info(`Delivery time saved (skipped coord address): ${deliveryTime}`);
            }
          } else if (hasLocationAlready) {
            // Has lat/long from WhatsApp location - preserve it, only update time
            logger.info(`Session already has location coordinates - preserving existing data`);
            let deliveryTime = aiResponse.fulfillment.delivery_time
              ? parseDeliveryTime(aiResponse.fulfillment.delivery_time, businessTimezone)
              : null;

            if (!deliveryTime) {
              const extracted = extractAddressAndTime(messageText, businessTimezone);
              if (extracted.time) {
                deliveryTime = extracted.time;
              }
            }

            if (deliveryTime && !sessionData?.delivery_time) {
              await updateSessionDeliveryInfo(session.id, { time: deliveryTime });
              logger.info(`Delivery time saved (preserving location): ${deliveryTime}`);

              // Show final invoice
              const deliverySummary = await generateOrderSummary(session.id, {
                includeCta: true,
                ctaMessage: t('orderSummary.reviewPromptAdd', lang),
                timezone: businessTimezone
              });
              replyMessage = deliverySummary;
            } else if (!sessionData?.delivery_time) {
              // Need to ask for time
              replyMessage = t('fulfillment.locationSavedThenAskTime', lang);
            }
          } else {
            // No existing location - save the AI-extracted address
            let deliveryTime = aiResponse.fulfillment.delivery_time
              ? parseDeliveryTime(aiResponse.fulfillment.delivery_time, businessTimezone)
              : null;

            // Fallback: Try to extract time from the original message if AI didn't get it
            if (!deliveryTime) {
              const extracted = extractAddressAndTime(messageText, businessTimezone);
              if (extracted.time) {
                deliveryTime = extracted.time;
              }
            }

            await updateSessionDeliveryInfo(session.id, {
              address: addressFromAI,
              time: deliveryTime || undefined,
              notes: aiResponse.fulfillment.fulfillment_notes,
            });
            logger.info(`Delivery info saved: ${addressFromAI}, time: ${deliveryTime || 'not provided'}`);

            // Check if time was provided - if not, ask for it
            if (!deliveryTime) {
              replyMessage = t('fulfillment.gotAddress', lang, { address: addressFromAI });
            } else {
              // Show final invoice with delivery details and ask for confirmation
              const deliverySummary = await generateOrderSummary(session.id, {
                includeCta: true,
                ctaMessage: t('orderSummary.reviewPromptAdd', lang),
                timezone: businessTimezone
              });
              replyMessage = deliverySummary;
            }
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

            // Validate pickup time against outlet operating hours
            if (pickupTime) {
              const validation = validateOperatingHours(pickupTime, selectedOutlet, businessTimezone);
              if (!validation.valid) {
                const reason = t(`time.${validation.reasonKey}` as any, lang, validation.reasonValues);
                logger.warn(`Pickup time ${pickupTime} rejected: ${reason}`);
                replyMessage = t('time.outsideHours', lang, { reason });
                break;
              }
            }

            await updateSessionPickupInfo(session.id, {
              outlet_id: selectedOutlet.id,
              time: pickupTime || undefined,
              notes: aiResponse.fulfillment.fulfillment_notes,
            });
            logger.info(`Pickup outlet selected: ${selectedOutlet.outlet_name}`);

            // If time was NOT provided, ask for it
            if (!pickupTime) {
              replyMessage = t('fulfillment.askPickupTime', lang, { outlet: selectedOutlet.outlet_name });
            } else {
              // Show final invoice with pickup details and ask for confirmation
              const pickupSummary = await generateOrderSummary(session.id, {
                includeCta: true,
                ctaMessage: `\n${t('fulfillment.pickupFrom', lang)}: ${selectedOutlet.outlet_name}\n${t('orderSummary.time', lang)}: ${pickupTime}\n\n${t('orderSummary.reviewPromptAdd', lang)}`,
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
            // Validate against outlet operating hours
            const selectedOutlet = outlets.find(o => o.id === latestSessionData.pickup_outlet_id);
            if (selectedOutlet) {
              const validation = validateOperatingHours(pickupTime, selectedOutlet, businessTimezone);
              if (!validation.valid) {
                const reason = t(`time.${validation.reasonKey}` as any, lang, validation.reasonValues);
                logger.warn(`Pickup time ${pickupTime} rejected: ${reason}`);
                replyMessage = t('time.outsideHours', lang, { reason });
                break;
              }
            }

            await updateSessionPickupInfo(session.id, {
              outlet_id: latestSessionData.pickup_outlet_id,
              time: pickupTime,
            });
            logger.info(`Pickup time saved: ${pickupTime}`);

            // Find outlet for display (already found above for validation)
            const outletName = selectedOutlet?.outlet_name || 'selected outlet';

            // Show final invoice with pickup details and ask for confirmation
            const pickupSummary = await generateOrderSummary(session.id, {
              includeCta: true,
              ctaMessage: `\n${t('fulfillment.pickupFrom', lang)}: ${outletName}\n${t('orderSummary.time', lang)}: ${pickupTime}\n\n${t('orderSummary.reviewPromptAdd', lang)}`,
              timezone: businessTimezone
            });
            replyMessage = pickupSummary;
          } else {
            replyMessage = t('time.invalidFormat', lang);
          }
        } else if (!session.pickup_outlet_id && outlets.length > 0) {
          // Use interactive list for outlet selection
          await saveOutgoingMessage(session.id, aiResponse.reply);
          await sendInteractiveListMessage(
            phone,
            t('buttons.pickupLocations', lang),
            aiResponse.reply,
            t('buttons.chooseLocation', lang),
            [{
              title: t('buttons.availableOutlets', lang),
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
      // Check if session has delivery location (address OR lat/long)
      const hasDeliveryLocation = latestSessionData.delivery_address ||
        (latestSessionData.delivery_latitude && latestSessionData.delivery_longitude);

      // Track if fulfillment was just collected in THIS message (not a real confirmation)
      // True if: address/outlet was just provided, OR time was just provided (not a "yes" to confirm)
      // IMPORTANT: Treat lat/long as equivalent to address for location check
      const fulfillmentJustCollected = aiResponse.fulfillment && (
        (aiResponse.fulfillment.delivery_address && !hasDeliveryLocation) ||
        (aiResponse.fulfillment.pickup_outlet_id && !latestSessionData.pickup_outlet_id) ||
        (aiResponse.fulfillment.delivery_time && !latestSessionData.delivery_time) ||
        (aiResponse.fulfillment.pickup_time && !latestSessionData.pickup_time)
      );

      // Check if fulfillment is ALREADY COMPLETE - don't overwrite with AI's re-sent data
      // This prevents AI hallucinations (e.g., "10PM" becoming "11:00 AM") from breaking orders
      // IMPORTANT: Treat lat/long as equivalent to address for delivery complete check
      const fulfillmentAlreadyComplete = latestSessionData.fulfillment_type && (
        (latestSessionData.fulfillment_type === 'delivery' && hasDeliveryLocation && latestSessionData.delivery_time) ||
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
          const addressFromAI = aiResponse.fulfillment.delivery_address;

          // Skip if AI extracted coordinate format (not a real address)
          const isCoordinateFormat = /^(Lat|Location|Latitude|Provided Location)[\s:(]*-?\d+\.?\d*/i.test(addressFromAI) ||
            /\(Lat[\s:]*-?\d+\.?\d*.*Long[\s:]*-?\d+\.?\d*\)/i.test(addressFromAI) ||
            /Lat[\s:]*-?\d+\.?\d*.*Long[\s:]*-?\d+\.?\d*/i.test(addressFromAI);

          // Check if session already has lat/long (location was shared via WhatsApp)
          const hasLocationAlready = latestSessionData.delivery_latitude && latestSessionData.delivery_longitude;

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

          // Validate delivery time against operating hours
          if (deliveryTime && outlets.length > 0) {
            const primaryOutlet = outlets[0];
            const validation = validateOperatingHours(deliveryTime, primaryOutlet, businessTimezone);
            if (!validation.valid) {
              const reason = t(`time.${validation.reasonKey}` as any, lang, validation.reasonValues);
              logger.warn(`Delivery time ${deliveryTime} rejected in confirm_order: ${reason}`);
              replyMessage = t('time.outsideHours', lang, { reason });
              break;
            }
          }

          if (isCoordinateFormat || hasLocationAlready) {
            // Skip saving AI address - preserve existing lat/long, only save time if provided
            logger.info(`Skipping AI address in confirm_order (coord format: ${isCoordinateFormat}, has location: ${hasLocationAlready})`);
            if (deliveryTime) {
              await updateSessionDeliveryInfo(session.id, { time: deliveryTime });
            }
          } else {
            await updateSessionDeliveryInfo(session.id, {
              address: addressFromAI,
              time: deliveryTime || undefined,
            });
          }
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

            // Validate pickup time against outlet operating hours
            if (pickupTime) {
              const selectedOutlet = outlets.find(o => o.id === outletId);
              if (selectedOutlet) {
                const validation = validateOperatingHours(pickupTime, selectedOutlet, businessTimezone);
                if (!validation.valid) {
                  const reason = t(`time.${validation.reasonKey}` as any, lang, validation.reasonValues);
                  logger.warn(`Pickup time ${pickupTime} rejected in confirm_order: ${reason}`);
                  replyMessage = t('time.outsideHours', lang, { reason });
                  break;
                }
              }
            }

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
            ctaMessage: t('orderSummary.reviewPromptAdd', lang),
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
        replyMessage = t('order.emptyCart', lang);
        break;
      }

      // VALIDATION: Check if fulfillment info is collected (use LATEST session data)
      if (!latestSession.fulfillment_type) {
        logger.warn(`⚠️ CONFIRM_ORDER attempted but no fulfillment type! Session: ${session.id}`);
        // Show summary and ask for fulfillment
        const orderSummary = await generateOrderSummary(session.id, { includeCta: false, timezone: businessTimezone });
        if (business?.supports_delivery && business?.supports_takeaway) {
          replyMessage = orderSummary + '\n\n' + t('fulfillment.askTypeDirect', lang);
        } else if (business?.supports_delivery) {
          replyMessage = orderSummary + '\n\n' + t('fulfillment.askAddress', lang);
        } else {
          replyMessage = orderSummary + '\n\n' + t('fulfillment.pickupPrompt', lang);
          if (outlets.length > 0) {
            replyMessage += '\n\n' + formatOutletsForCustomer(outlets);
          }
        }
        break;
      }

      // For delivery, check if address OR location is provided
      const hasDeliveryLocationForValidation = latestSession.delivery_address ||
        (latestSession.delivery_latitude && latestSession.delivery_longitude);
      if (latestSession.fulfillment_type === 'delivery' && !hasDeliveryLocationForValidation) {
        logger.warn(`⚠️ CONFIRM_ORDER attempted but no delivery address/location! Session: ${session.id}`);
        replyMessage = t('fulfillment.noAddress', lang);
        break;
      }

      // For takeaway, check if outlet is selected
      if (latestSession.fulfillment_type === 'takeaway' && !latestSession.pickup_outlet_id && outlets.length > 0) {
        logger.warn(`⚠️ CONFIRM_ORDER attempted but no pickup outlet! Session: ${session.id}`);
        replyMessage = t('fulfillment.noOutlet', lang, { outlets: formatOutletsForCustomer(outlets) });
        break;
      }

      // MANDATORY: Check if date/time is provided - orders cannot be confirmed without timing
      const hasDeliveryTime = latestSession.fulfillment_type === 'delivery' && latestSession.delivery_time;
      const hasPickupTime = latestSession.fulfillment_type === 'takeaway' && latestSession.pickup_time;

      if (!hasDeliveryTime && !hasPickupTime) {
        logger.warn(`⚠️ CONFIRM_ORDER attempted but no date/time provided! Session: ${session.id}`);
        const timeExamples = t('time.examples', lang);
        if (latestSession.fulfillment_type === 'delivery') {
          replyMessage = t('time.needTime', lang, { type: t('time.deliveryTime', lang), examples: timeExamples });
        } else {
          replyMessage = t('time.needTime', lang, { type: t('time.pickupTime', lang), examples: timeExamples });
        }
        break;
      }

      // ============================================ 
      // CUSTOM CAKE: Block order if time not confirmed by admin
      // ============================================ 
      const customCakeQuote = await getAcceptedQuoteForSession(session.id);
      if (customCakeQuote && customCakeQuote.requested_delivery_time && !customCakeQuote.time_confirmed) {
        logger.warn(`⏳ Custom cake order blocked - waiting for admin time confirmation. Quote: ${customCakeQuote.id}`);
        replyMessage = t('customCake.waitingConfirmation', lang);
        break;
      }

      try {
        logger.info(`📦 Creating order with ${latestSession.items.length} items for session ${session.id}`);
        const order = await createFinalOrder(session.id);

        // businessTimezone is already defined at the start of processMessage

        // Build confirmation message with fulfillment details (use LATEST session data)
        let confirmMsg = `${t('order.confirmed', lang)}\n\n📋 ${t('order.orderNumber', lang)}: *${order.order_number}*\n${t('order.total', lang, { amount: order.total_amount })}`;

        if (latestSession.fulfillment_type === 'delivery') {
          confirmMsg += `\n\n${t('order.delivery', lang)}\n📍 ${latestSession.delivery_address}`;
          if (latestSession.delivery_time) {
            confirmMsg += `\n${t('order.time', lang, { time: formatDeliveryTime(latestSession.delivery_time, businessTimezone, t('time.at', lang)) })}`;
          }
        } else if (latestSession.fulfillment_type === 'takeaway') {
          confirmMsg += `\n\n${t('order.takeaway', lang)}`;
          const selectedOutlet = outlets.find(o => o.id === latestSession.pickup_outlet_id);
          if (selectedOutlet) {
            confirmMsg += `\n📍 ${selectedOutlet.outlet_name}`;
          }
          if (latestSession.pickup_time) {
            confirmMsg += `\n${t('order.time', lang, { time: formatDeliveryTime(latestSession.pickup_time, businessTimezone, t('time.at', lang)) })}`;
          }
        }

        confirmMsg += `\n\n_${t('order.saveNumber', lang, { orderNumber: order.order_number })}_`;
        const closingMsg = business?.closing_message || 'Thank you for your order!';
        confirmMsg += `\n\n${closingMsg} 🙏`;
        replyMessage = confirmMsg;
      } catch (error) {
        logger.error('Failed to create order', error);
        const supportPhone = business?.customer_support_phone;
        replyMessage = t('order.failed', lang, {
          support: supportPhone ? t('error.contactSupport', lang, { phone: supportPhone }) : '',
        });
      }
      break;

    case 'cancel':
      replyMessage = t('order.cancelled', lang);
      break;

    case 'cancel_existing_order':
      if (aiResponse.order_id) {
        const cancelResult = await cancelOrderById(aiResponse.order_id, customer.id, businessId);
        if (cancelResult.success) {
          replyMessage = t('order.cancelledSuccess', lang, { message: cancelResult.message });
        } else {
          replyMessage = t('order.cancelFailed', lang, { message: cancelResult.message });
        }
      } else {
        replyMessage = t('order.provideOrderNumber', lang);
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
          replyMessage = t('order.cancelFailed', lang, { message: statusResult.message });
        }
      } else {
        // No order number provided - try to find their active order
        const activeOrder = await getCustomerActiveOrder(customer.id, businessId);
        if (activeOrder) {
          replyMessage = getOrderStatusMessage(activeOrder, lang, businessTimezone);
        } else {
          replyMessage = t('order.noActive', lang);
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
            const addressFromAI = aiResponse.fulfillment.delivery_address;

            // Skip if AI extracted coordinate format (not a real address)
            const isCoordinateFormat = /^(Lat|Location|Latitude|Provided Location)[\s:(]*-?\d+\.?\d*/i.test(addressFromAI) ||
              /\(Lat[\s:]*-?\d+\.?\d*.*Long[\s:]*-?\d+\.?\d*\)/i.test(addressFromAI) ||
              /Lat[\s:]*-?\d+\.?\d*.*Long[\s:]*-?\d+\.?\d*/i.test(addressFromAI);

            // Check if session already has lat/long
            const sessionData = await getSessionWithItems(session.id);
            const hasLocationAlready = sessionData?.delivery_latitude && sessionData?.delivery_longitude;

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

            if (isCoordinateFormat || hasLocationAlready) {
              // Skip saving AI address - preserve existing lat/long, only save time if provided
              logger.info(`Skipping AI address in ask_question (coord format: ${isCoordinateFormat}, has location: ${hasLocationAlready})`);
              if (deliveryTime) {
                await updateSessionDeliveryInfo(session.id, { time: deliveryTime });
              }
            } else {
              await updateSessionDeliveryInfo(session.id, {
                address: addressFromAI,
                time: deliveryTime || undefined,
                notes: aiResponse.fulfillment.fulfillment_notes,
              });
              logger.info(`Delivery info saved: ${addressFromAI}, time: ${deliveryTime || 'not provided'}`);

              // If no time provided, prompt for it
              if (!deliveryTime) {
                replyMessage = t('fulfillment.gotAddress', lang, { address: addressFromAI });
              }
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

    case 'amenity_inquiry':
      // Customer is asking about an amenity (party hall, etc.)
      if (aiResponse.amenity?.amenity_slug && business) {
        const amenity = await getAmenityBySlug(business.id, aiResponse.amenity.amenity_slug);
        if (amenity) {
          // Send amenity description first
          replyMessage = amenity.description;

          // Check for multiple images first, then fall back to single image_url
          const imagesToSend = amenity.images?.length > 0
            ? amenity.images
            : (amenity.image_url ? [amenity.image_url] : []);

          if (imagesToSend.length > 0) {
            // Send text message first
            await sendWhatsAppMessage(phone, replyMessage);

            // Send all images
            for (const imageUrl of imagesToSend) {
              await sendImage(phone, imageUrl);
            }

            // Mark that we've already sent the message
            replyMessage = ''; // Clear so we don't send duplicate
          }
        } else {
          // Amenity not found, use AI's reply
          replyMessage = aiResponse.reply;
        }
      }
      break;

    case 'amenity_booking_request':
      // Customer wants to book/reserve an amenity - notify admin
      if (business) {
        const amenitySlug = aiResponse.amenity?.amenity_slug || 'unknown';
        const amenityName = aiResponse.amenity?.amenity_slug
          ? (await getAmenityBySlug(business.id, aiResponse.amenity.amenity_slug))?.name || amenitySlug
          : 'an amenity';

        // Create notification for admin
        await notifyBusinessAdmin(business.id, {
          type: 'amenity_booking',
          customerId: customer?.id,
          phone: phone,
          message: `Customer wants to book ${amenityName}. Phone: ${phone}`,
        });

        replyMessage = aiResponse.reply || t('amenity.bookingRequestConfirmation', lang, { amenity: amenityName });
      }
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

        // Extract customer name from WhatsApp contacts
        const customerName = value.contacts?.[0]?.profile?.name || undefined;
        if (customerName) {
          logger.info(`WhatsApp customer name: ${customerName}`);
        }

        for (const message of value.messages) {
          const phone = sanitizePhoneNumber(message.from);

          // Mark message as read immediately (shows blue checkmarks to sender)
          if (message.id) {
            markAsRead(message.id).catch(() => { });
          }

          // Handle image messages (Feature 4)
          if (message.type === 'image' && message.image) {
            logger.info(`Image received from ${phone}: ${message.image.id}`);

            // Find or create customer for notification
            const customer = await findOrCreateCustomer(phone, business.id, customerName);
            const { session } = await findOrCreateSession(customer.id, business.id);

            // Check if custom cake pricing is enabled for this business
            const customCakeEnabled = (business as any).custom_cake_enabled === true;
            const imageMimeType = message.image.mime_type || 'image/jpeg';

            // Download and save image to messages (ALWAYS, regardless of custom cake status)
            // Include buffer if custom cake is enabled (for AI analysis)
            const mediaResult = await processIncomingMedia(
              message.image.id,
              imageMimeType,
              business.id,
              undefined,
              customCakeEnabled // Include buffer for AI analysis if custom cake enabled
            );

            const imageUrl = mediaResult?.mediaUrl || '';
            const imageBuffer = mediaResult?.buffer;

            await saveIncomingMediaMessage(
              session.id,
              'image',
              imageUrl,
              imageMimeType,
              {
                caption: message.image.caption,
                size: mediaResult?.fileSize,
                mediaId: message.image.id,
              }
            );

            logger.info(`Image saved to messages: ${imageUrl ? 'with URL' : 'without URL'}`);

            if (customCakeEnabled) {
              // 1. Get current context
              const context = session.custom_cake_context;

              // CASE 1: Already awaiting image (text inquiry came first)
              if (context?.awaiting_image) {
                logger.info(`Processing image for awaiting context: session ${session.id}`);

                // Clear context before processing
                await clearSessionCustomCakeContext(session.id);

                await processCustomCakeWithIntervention(
                  business.id,
                  session.id,
                  customer.id,
                  phone,
                  imageUrl,
                  context.weight,
                  context.flavor,
                  imageBuffer, // Pass buffer for AI analysis
                  imageMimeType
                );
                continue;
              }

              // CASE 2: Check caption for cake keywords
              const caption = message.image.caption?.toLowerCase() || '';
              const hasCakeKeywordsInCaption = CAKE_KEYWORDS.some(k => caption.includes(k));

              if (hasCakeKeywordsInCaption) {
                logger.info(`Processing image with cake caption: "${caption}"`);
                await processCustomCakeWithIntervention(
                  business.id,
                  session.id,
                  customer.id,
                  phone,
                  imageUrl,
                  undefined,
                  undefined,
                  imageBuffer, // Pass buffer for AI analysis
                  imageMimeType
                );
                continue;
              }

              // CASE 3: Check recent messages (simple check if no context)
              // We skip this for now to rely on explicit confirmation if no context

              // CASE 4: No context - store pending and wait 30s
              logger.info(`No context for image - storing pending state for session ${session.id}`);

              // Store pending state with actual image URL
              // Note: We store the buffer reference for later use when user confirms
              await updateSessionCustomCakeContext(session.id, {
                pending_image_id: message.image.id,
                pending_image_timestamp: new Date().toISOString(),
                image_url: imageUrl,
                awaiting_clarification: false,
              });

              // Don't reply yet - wait for follow-up (30s check in processMessage)
              continue;

            } else {
              // Custom cakes disabled - image already saved to messages above
              logger.info(`Custom cakes disabled for business, image saved to chat history`);
            }
          }

          // Handle location messages


          // }

          // Handle video messages
          if (message.type === 'video' && message.video) {
            logger.info(`Video received from ${phone}: ${message.video.id}`);

            const customer = await findOrCreateCustomer(phone, business.id, customerName);
            const { session } = await findOrCreateSession(customer.id, business.id);

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
                mediaId: message.video.id,
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
              const lang = getSessionLanguage(session);
              const supportPhone = business.customer_support_phone;
              const support = supportPhone ? t('error.contactSupport', lang, { phone: supportPhone }) : '';
              const videoResponse = t('video.fallback', lang, { support });
              await sendWhatsAppMessage(phone, videoResponse);
              await saveOutgoingMessage(session.id, videoResponse);
            }
            continue;
          }

          // Handle document messages
          if (message.type === 'document' && message.document) {
            logger.info(`Document received from ${phone}: ${message.document.id}`);

            const customer = await findOrCreateCustomer(phone, business.id, customerName);
            const { session } = await findOrCreateSession(customer.id, business.id);

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
                mediaId: message.document.id,
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
              const lang = getSessionLanguage(session);
              const supportPhone = business.customer_support_phone;
              const support = supportPhone ? t('error.contactSupport', lang, { phone: supportPhone }) : '';
              const docResponse = t('document.fallback', lang, { support });
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

            const customer = await findOrCreateCustomer(phone, business.id, customerName);
            const { session } = await findOrCreateSession(customer.id, business.id);

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
                { size: mediaResult?.fileSize, mediaId: audioId }
              );
              continue;
            }

            const lang = getSessionLanguage(session);

            // Check if voice feature is enabled (premium feature)
            if (!isVoiceEnabled()) {
              logger.info('Voice feature disabled');
              await saveIncomingMediaMessage(
                session.id,
                'audio',
                mediaResult?.mediaUrl || '',
                audioMimeType,
                { size: mediaResult?.fileSize, mediaId: audioId }
              );
              const notEnabledReply = t('voice.notEnabled', lang);
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
                { size: mediaResult?.fileSize, mediaId: audioId }
              );
              const noSpeechReply = t('voice.noTranscription', lang);
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
                  mediaId: audioId,
                }
              );

              // Process transcription as a normal text message
              const reply = await processMessage(phone, transcription, business.id, customerName);

              if (reply !== null) {
                // Prepend transcription confirmation to the reply
                const voiceReply = t('voice.transcriptionPrefix', lang, { transcription }) + reply;
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
                { size: mediaResult?.fileSize, mediaId: audioId }
              );

              const supportPhone = business.customer_support_phone;
              const support = supportPhone ? t('error.contactSupport', lang, { phone: supportPhone }) : '';
              const errorReply = t('voice.processingFailed', lang, { support });
              await sendWhatsAppMessage(phone, errorReply);
              await saveOutgoingMessage(session.id, errorReply);
            }
            continue;
          }

          // Handle sticker messages - save for admin to see, no AI processing
          if (message.type === 'sticker' && message.sticker) {
            logger.info(`Sticker received from ${phone}: ${message.sticker.id}`);

            const customer = await findOrCreateCustomer(phone, business.id, customerName);
            const { session } = await findOrCreateSession(customer.id, business.id);

            // Download and store the sticker
            const mediaResult = await processIncomingMedia(
              message.sticker.id,
              message.sticker.mime_type || 'image/webp',
              business.id
            );

            // Save message with sticker info (admin can see it in chat)
            await saveIncomingMediaMessage(
              session.id,
              'sticker',
              mediaResult?.mediaUrl || '',
              message.sticker.mime_type || 'image/webp',
              { size: mediaResult?.fileSize, mediaId: message.sticker.id }
            );

            // No automated response for stickers - just save for admin visibility
            logger.debug(`Sticker saved for session ${session.id}`);
            continue;
          }

          // Handle location messages (Feature 3)
          if (message.type === 'location' && message.location) {
            const location = message.location;
            logger.info(`[DEBUG-LOC] Step 1: Location received from ${phone}: ${location.latitude}, ${location.longitude}`);

            try {
              logger.info(`[DEBUG-LOC] Step 2: Finding/creating customer...`);
              const customer = await findOrCreateCustomer(phone, business.id, customerName);
              logger.info(`[DEBUG-LOC] Step 2 done: customer.id=${customer.id}`);

              logger.info(`[DEBUG-LOC] Step 3: Finding/creating session...`);
              const { session } = await findOrCreateSession(customer.id, business.id);
              logger.info(`[DEBUG-LOC] Step 3 done: session.id=${session.id}`);

              logger.info(`[DEBUG-LOC] Step 4: Getting session with items...`);
              const sessionWithItems = await getSessionWithItems(session.id);
              logger.info(`[DEBUG-LOC] Step 4 done: fulfillment_type=${sessionWithItems?.fulfillment_type}, delivery_address=${sessionWithItems?.delivery_address}`);

              // Use address/name from location if available, otherwise reverse geocode
              // The lat/long will be stored in separate columns for map display
              let displayAddress: string | null = location.address || location.name || null;
              logger.info(`[DEBUG-LOC] Step 5: WhatsApp address=${displayAddress || 'NONE'}`);

              // If no address provided by WhatsApp, try reverse geocoding
              if (!displayAddress) {
                logger.info(`[DEBUG-LOC] Step 5a: Reverse geocoding ${location.latitude}, ${location.longitude}`);
                try {
                  displayAddress = await getAddressFromCoordinates(location.latitude, location.longitude);
                  logger.info(`[DEBUG-LOC] Step 5a done: geocoded address=${displayAddress || 'NULL (will use lat/long)'}`);
                } catch (geoError) {
                  // Geocoding failed - address stays null, lat/long will still be saved
                  logger.warn(`[DEBUG-LOC] Geocoding failed, will save lat/long only:`, geoError);
                  displayAddress = null;
                }
              }

              const logAddress = displayAddress;
              logger.info(`[DEBUG-LOC] Step 6: Saving incoming message...`);
              await saveIncomingMessage(session.id, `[Location: ${logAddress}]`, {
                messageType: 'location',
                latitude: location.latitude,
                longitude: location.longitude,
              });
              logger.info(`[DEBUG-LOC] Step 6 done`);

              // If customer is in delivery flow and hasn't provided address yet
              // Save lat/long only, ask for full address with landmark
              if (sessionWithItems?.fulfillment_type === 'delivery' && !sessionWithItems.delivery_address && !sessionWithItems.delivery_latitude) {
                logger.info(`[DEBUG-LOC] Step 7: Saving lat/long only (address=NULL), will ask for full address...`);
                await updateSessionDeliveryInfo(session.id, {
                  address: null, // Don't save geocoded address - ask user for full address
                  latitude: location.latitude,
                  longitude: location.longitude,
                });
                logger.info(`[DEBUG-LOC] Step 7 done`);

                // Check if location is beyond max delivery radius
                const deliveryFeeResult = await calculateDistanceBasedDeliveryFee(
                  business.id,
                  0, // Order amount not needed for distance check
                  location.latitude,
                  location.longitude
                );

                if (deliveryFeeResult.is_beyond_max_radius) {
                  logger.info(`[DEBUG-LOC] Location beyond max radius: ${(deliveryFeeResult.distance_meters / 1000).toFixed(2)}km`);

                  // Set session as pending approval
                  const { supabase } = await
                    import('../config/database');
                  await supabase
                    .from('sessions')
                    .update({
                      delivery_pending_approval: true,
                      delivery_approval_status: 'pending',
                    })
                    .eq('id', session.id);

                  // Notify admin/operations team with session ID for approval
                  await notifyBusinessAdmin(business.id, {
                    type: 'delivery_beyond_radius',
                    customerId: customer.id,
                    phone: phone,
                    message: `Customer location is ${(deliveryFeeResult.distance_meters / 1000).toFixed(1)}km away - beyond max delivery radius. Session: ${session.id}. Address: ${displayAddress || 'Location shared'}`,
                  });

                  // Inform customer
                  const lang = getSessionLanguage(session);
                  const beyondRadiusMsg = t('fulfillment.beyondArea', lang, { distance: `${(deliveryFeeResult.distance_meters / 1000).toFixed(1)}km` });
                  await sendWhatsAppMessage(phone, beyondRadiusMsg);
                  await saveOutgoingMessage(session.id, beyondRadiusMsg);
                  logger.info(`[DEBUG-LOC] Beyond radius - pending approval set for session ${session.id}`);
                  continue;
                }

                // Ask for full address with landmark (lat/long saved, need human-readable address)
                logger.info(`[DEBUG-LOC] Step 8: Asking for full address with landmark...`);
                const lang = getSessionLanguage(session);
                const askAddressPrompt = t('fulfillment.locationSavedAskFullAddress', lang);
                await sendWhatsAppMessage(phone, askAddressPrompt);
                await saveOutgoingMessage(session.id, askAddressPrompt);
                logger.info(`[DEBUG-LOC] Step 8 done - waiting for full address`);
              } else {
                // Not in delivery flow yet OR already has location - still save it for later use
                logger.info(`[DEBUG-LOC] Step 9: Saving location for future use...`);

                // Save location to session (will be used when user chooses delivery later)
                await updateSessionDeliveryInfo(session.id, {
                  address: displayAddress, // Can be null if geocoding failed
                  latitude: location.latitude,
                  longitude: location.longitude,
                });
                logger.info(`[DEBUG-LOC] Step 9: Location saved (lat=${location.latitude}, long=${location.longitude}, addr=${displayAddress || 'NULL'})`);

                const lang = getSessionLanguage(session);
                const locationReply = t('fulfillment.locationSavedForLater', lang);
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
                const customer = await findOrCreateCustomer(phone, business.id, customerName);
                const { session } = await findOrCreateSession(customer.id, business.id);
                const businessOutlets = await getBusinessOutlets(business.id);

                // Set fulfillment type to takeaway and CLEAR any previous delivery info
                await updateSessionFulfillmentType(session.id, 'takeaway');

                if (businessOutlets.length > 0) {
                  const lang = getSessionLanguage(session);
                  await saveIncomingMessage(session.id, `[Selected: ${t('fulfillment.takeawayBtn', lang)}]`);
                  const outletPrompt = t('fulfillment.selectOutlet', lang);
                  await saveOutgoingMessage(session.id, outletPrompt);
                  await sendInteractiveListMessage(
                    phone,
                    t('buttons.pickupLocations', lang),
                    outletPrompt,
                    t('buttons.chooseLocation', lang),
                    [{
                      title: t('buttons.availableOutlets', lang),
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
                const customer = await findOrCreateCustomer(phone, business.id, customerName);
                const { session } = await findOrCreateSession(customer.id, business.id);

                // Set fulfillment type to delivery (this will clear takeaway info in the handler)
                await updateSessionFulfillmentType(session.id, 'delivery');
                const lang = getSessionLanguage(session);
                await saveIncomingMessage(session.id, `[Selected: ${t('fulfillment.deliveryBtn', lang)}]`);
                const deliveryPrompt = t('fulfillment.deliveryLocationPrompt', lang);
                await saveOutgoingMessage(session.id, deliveryPrompt);
                // Send location request with the prompt
                await sendLocationRequest(phone, deliveryPrompt);
                continue;
              }

              // Handle show_menu button from welcome message
              if (buttonId === 'show_menu') {
                const customer = await findOrCreateCustomer(phone, business.id, customerName);
                const { session } = await findOrCreateSession(customer.id, business.id);
                const lang = getSessionLanguage(session);
                await saveIncomingMessage(session.id, `[Clicked: ${t('menu.browseBtn', lang)}]`);

                // Send PDF menu if available, otherwise fallback to interactive menu
                const menuConfigs = await getActiveMenuPdfConfigs(business.id);

                if (menuConfigs.length > 0) {
                  // Send all menu PDFs
                  for (const config of menuConfigs) {
                    if (config.pdf_url) {
                      await sendDocument(
                        phone,
                        config.pdf_url,
                        `${config.name}.pdf`,
                        config.name // Caption = menu name
                      );
                    }
                  }
                  await saveOutgoingMessage(session.id, `[Sent ${menuConfigs.length} menu PDF(s)]`);
                  continue;
                } else {
                  // Fallback to full menu PDF if no configs
                  const pdfExists = await menuPdfExists(business.id);
                  if (pdfExists) {
                    const pdfUrl = await getMenuPdfUrl(business.id);
                    if (pdfUrl) {
                      const pdfCaption = t('menu.pdfCaption', lang);
                      await sendDocument(phone, pdfUrl, `${business.name}_Menu.pdf`, pdfCaption);
                      await saveOutgoingMessage(session.id, `[Menu PDF sent]`);
                      continue;
                    }
                  }
                }

                // Fallback to interactive menu list
                const menuCategories = await getMenuCategories(business.id);
                const categorySections = buildCategoryListSections(menuCategories);
                if (categorySections.length > 0 && categorySections[0].rows.length > 0) {
                  await sendInteractiveListMessage(
                    phone,
                    t('menu.ourMenu', lang),
                    t('menu.welcome', lang, { businessName: business.name }),
                    t('menu.browseBtn', lang),
                    categorySections
                  );
                  await saveOutgoingMessage(session.id, `[Interactive menu sent]`);
                } else {
                  await sendWhatsAppMessage(phone, t('menu.fallback', lang));
                  await saveOutgoingMessage(session.id, t('menu.fallback', lang));
                }
                continue;
              }

              // Handle show_menu_<slug> buttons for specific menu PDFs
              if (buttonId.startsWith('show_menu_')) {
                const menuSlug = buttonId.replace('show_menu_', '');
                const customer = await findOrCreateCustomer(phone, business.id, customerName);
                const { session } = await findOrCreateSession(customer.id, business.id);
                const lang = getSessionLanguage(session);

                const menuConfig = await getMenuPdfConfigBySlug(business.id, menuSlug);
                if (menuConfig?.pdf_url) {
                  const localizedName = getLocalizedMenuName(menuConfig, lang);
                  await saveIncomingMessage(session.id, `[Clicked: ${localizedName}]`);
                  await sendDocument(
                    phone,
                    menuConfig.pdf_url,
                    `${localizedName}.pdf`,
                    localizedName // Caption in user's language
                  );
                  await saveOutgoingMessage(session.id, `[Sent ${localizedName} PDF]`);
                } else {
                  // Fallback if config not found
                  await sendWhatsAppMessage(phone, t('menu.fallback', lang));
                  await saveOutgoingMessage(session.id, t('menu.fallback', lang));
                }
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
                    const customer = await findOrCreateCustomer(phone, business.id, customerName);
                    const { session } = await findOrCreateSession(customer.id, business.id);

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
                const customer = await findOrCreateCustomer(phone, business.id, customerName);
                const { session } = await findOrCreateSession(customer.id, business.id);
                const isDelivery = buttonId.includes('_delivery');
                const fulfillmentType = isDelivery ? 'delivery' : 'takeaway';
                const lang = getSessionLanguage(session);

                if (buttonId.includes('_today_')) {
                  // Store date selection and show time buttons
                  pendingDateSelectionMap.set(session.id, { date: 'today', fulfillmentType });
                  await saveIncomingMessage(session.id, `[Selected: ${t('buttons.today', lang)}]`);

                  // Different time options for delivery vs takeaway
                  const timePrompt = t('buttons.whatTime', lang, { date: `*${t('buttons.today', lang)}*` });
                  await saveOutgoingMessage(session.id, timePrompt);

                  if (isDelivery) {
                    // Delivery: In 1 hour, In 1.5 hours, Other
                    await sendReplyButtons(phone, timePrompt, [
                      { id: 'time_1hour', title: '🕐 In 1 hour' },
                      { id: 'time_1_5hour', title: '🕐 In 1.5 hours' },
                      { id: 'time_other', title: `⏰ ${t('buttons.other', lang)}` },
                    ]);
                  } else {
                    // Takeaway: In 30 min, In 1 hour, Other
                    await sendReplyButtons(phone, timePrompt, [
                      { id: 'time_30min', title: '🕐 In 30 min' },
                      { id: 'time_1hour', title: '🕐 In 1 hour' },
                      { id: 'time_other', title: `⏰ ${t('buttons.other', lang)}` },
                    ]);
                  }
                  continue;
                }

                if (buttonId.includes('_tomorrow_')) {
                  // Store date selection and show time buttons for tomorrow
                  pendingDateSelectionMap.set(session.id, { date: 'tomorrow', fulfillmentType });
                  await saveIncomingMessage(session.id, `[Selected: ${t('buttons.tomorrow', lang)}]`);

                  const timePrompt = t('buttons.whatTime', lang, { date: `*${t('buttons.tomorrow', lang)}*` });
                  await saveOutgoingMessage(session.id, timePrompt);

                  // Tomorrow: Morning, Afternoon, Other
                  await sendReplyButtons(phone, timePrompt, [
                    { id: 'time_morning', title: '🌅 Morning (10 AM)' },
                    { id: 'time_afternoon', title: '🌞 Afternoon (2 PM)' },
                    { id: 'time_other', title: `⏰ ${t('buttons.other', lang)}` },
                  ]);
                  continue;
                }

                if (buttonId.includes('_other_')) {
                  // User wants to specify custom date/time - fall back to text input
                  pendingDateSelectionMap.delete(session.id);
                  await saveIncomingMessage(session.id, `[Selected: ${t('buttons.other', lang)}]`);

                  const customPrompt = t('buttons.customTimePrompt', lang);
                  await sendWhatsAppMessage(phone, customPrompt);
                  await saveOutgoingMessage(session.id, customPrompt);
                  continue;
                }
              }

              // Handle TIME selection buttons
              if (buttonId.startsWith('time_')) {
                const customer = await findOrCreateCustomer(phone, business.id, customerName);
                const { session } = await findOrCreateSession(customer.id, business.id);
                const sessionWithItems = await getSessionWithItems(session.id);
                const pendingDate = pendingDateSelectionMap.get(session.id);
                const lang = getSessionLanguage(session);

                if (buttonId === 'time_other') {
                  // User wants custom time - fall back to text input
                  pendingDateSelectionMap.delete(session.id);
                  await saveIncomingMessage(session.id, `[Selected: ${t('buttons.other', lang)}]`);

                  const dateText = pendingDate?.date === 'tomorrow' ? t('buttons.tomorrow', lang) : t('buttons.today', lang);
                  const customPrompt = t('buttons.customTimePromptForDate', lang, { date: dateText });
                  await sendWhatsAppMessage(phone, customPrompt);
                  await saveOutgoingMessage(session.id, customPrompt);
                  continue;
                }

                // Calculate actual datetime from button selection
                const dateSelection = pendingDate?.date || 'today';
                const calculatedTime = calculateDateTimeFromButtons(dateSelection, buttonId, businessTimezone);

                if (!calculatedTime) {
                  logger.error(`Failed to calculate time for: ${dateSelection} ${buttonId}`);
                  await sendWhatsAppMessage(phone, t('time.calculationError', lang));
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

                const fulfillmentType = pendingDate?.fulfillmentType || sessionWithItems?.fulfillment_type;

                // ============================================
                // CUSTOM CAKE TIME CONFIRMATION CHECK (BUTTON FLOW)
                // ============================================
                const acceptedQuoteForTime = await getAcceptedQuoteForSession(session.id);

                if (acceptedQuoteForTime && !acceptedQuoteForTime.time_confirmed) {
                  // This is a custom cake order - time needs admin confirmation
                  const fulfillmentTypeForQuote = fulfillmentType === 'delivery' ? 'delivery' : 'takeaway';
                  logger.info(`🎂 Custom cake time request (button): ${calculatedTime} (${fulfillmentTypeForQuote})`);

                  // Save time to quote (pending confirmation)
                  await updateQuoteTimeRequest(acceptedQuoteForTime.id, calculatedTime, fulfillmentTypeForQuote);

                  // Also save to session for display purposes
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

                  // Create intervention for admin dashboard
                  const timeInterventionBtn = await createIntervention(
                    business.id,
                    session.id,
                    customer.id,
                    'custom_cake_time_confirmation',
                    {
                      quoteId: acceptedQuoteForTime.id,
                      requestedTime: calculatedTime,
                      fulfillmentType: fulfillmentTypeForQuote,
                      phone,
                    }
                  );

                  if (timeInterventionBtn) {
                    // Pause AI for admin to handle
                    await pauseAI(session.id, 'Custom cake time confirmation pending');
                    // Emit WebSocket event for admin dashboard
                    emitInterventionCreated(business.id, timeInterventionBtn);
                  }

                  // Notify admin about time confirmation request
                  await notifyBusinessAdmin(business.id, {
                    type: 'cake_time_confirmation',
                    customerId: customer.id,
                    phone,
                    message: `Custom cake time confirmation needed: ${calculatedTime} (${fulfillmentTypeForQuote})`,
                    quoteId: acceptedQuoteForTime.id,
                  });

                  // Clear pending date selection
                  pendingDateSelectionMap.delete(session.id);

                  // Tell customer to wait for confirmation
                  const timeConfirmMsg = t('customCake.timeConfirmRequest', lang, {
                    type: fulfillmentTypeForQuote,
                    time: calculatedTime,
                  });
                  await sendWhatsAppMessage(phone, timeConfirmMsg);
                  await saveOutgoingMessage(session.id, timeConfirmMsg);
                  continue;
                }

                // Normal flow - save time and show final invoice
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
                  ctaMessage: `\n${t('orderSummary.reviewPrompt', lang)}`,
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
              const customer = await findOrCreateCustomer(phone, business.id, customerName);
              const { session } = await findOrCreateSession(customer.id, business.id);
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
                    const lang = getSessionLanguage(session);
                    const sizeButtons = buildSizeButtons(menuItem);
                    const sizePrompt = t('menu.selectSize', lang, { item: `*${menuItem.name}*` });
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

                    const lang = getSessionLanguage(session);
                    const itemIdentifier = size ? `*${menuItem.name}* (${size})` : `*${menuItem.name}*`;
                    const addedMsg = `${t('cart.added', lang, { item: itemIdentifier })} ${t('cart.anythingElse', lang)}`;
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

          // Queue message for debouncing - waits for user to finish typing
          // Multiple rapid messages will be combined into one before processing
          queueMessageForDebounce(phone, messageText, business.id, customerName);
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

// ============================================
// HELPERS
// ============================================

async function processCustomCakeWithIntervention(
  businessId: string,
  sessionId: string,
  customerId: string,
  phone: string,
  imageUrl: string,
  weight?: string,
  flavor?: string,
  imageBuffer?: Buffer,
  mimeType?: string
) {
  // 1. Analyze image with Gemini if buffer is provided
  let aiAnalysis: any = null;

  if (imageBuffer && mimeType) {
    try {
      logger.info(`Analyzing cake image with Gemini for session ${sessionId}`);
      const pricingConfig = await getFullPricingConfig(businessId);
      const imageBase64 = imageBuffer.toString('base64');

      const analysis = await analyzeImageWithGemini(
        imageBase64,
        mimeType,
        pricingConfig,
        weight,
        flavor
      );

      if (analysis) {
        aiAnalysis = analysis;
        logger.info(`AI Analysis complete: ${analysis.complexity_level} complexity, ${analysis.detected_elements?.length || 0} elements detected`);
      }
    } catch (error) {
      logger.error('Failed to analyze image with Gemini, continuing without AI analysis', error);
      // Continue without AI analysis - admin can still review manually
    }
  }

  // 2. Create intervention with AI analysis
  const intervention = await createIntervention(
    businessId,
    sessionId,
    customerId,
    'custom_cake',
    {
      image_url: imageUrl,
      customer_weight: weight,
      customer_flavor: flavor,
    },
    aiAnalysis || undefined // Pass AI analysis if available
  );

  if (intervention) {
    // 3. Pause AI
    await pauseAI(sessionId, 'Custom Cake Inquiry');

    // 4. Emit socket event to notify admin dashboard
    emitInterventionCreated(businessId, intervention);
    logger.info(`WebSocket: intervention_created emitted for business ${businessId}, intervention ${intervention.id}`);

    // 5. Clear context flags
    await clearSessionCustomCakeContext(sessionId);

    // 6. Send holding message and save to chat history
    const holdingMessage = "Thank you for sharing! Our team is preparing a customized quote for you.";
    await saveOutgoingMessage(sessionId, holdingMessage);
    await sendWhatsAppMessage(phone, holdingMessage);
  } else {
    logger.error(`Failed to create intervention for session ${sessionId}`);
  }
}

async function checkPendingImageClarification(session: Session, phone: string, businessId: string): Promise<boolean> {
  const context = session.custom_cake_context;

  if (!context?.pending_image_timestamp) return false;

  const pendingTime = new Date(context.pending_image_timestamp);
  const elapsed = Date.now() - pendingTime.getTime();

  // If 30s passed and not yet asked for clarification
  // (We use 30s as per requirement)
  if (elapsed > 30000 && !context.awaiting_clarification) {
    logger.info(`30s elapsed for pending image - asking clarification for session ${session.id}`);

    const lang = getSessionLanguage(session);
    // Need a translation key for this, using hardcoded for now or generic fallback
    const clarificationMsg = t('image.askCakeContext', lang);
    const finalMsg = (!clarificationMsg || clarificationMsg.includes('image.'))
      ? `I received your image! 📸\n\nCould you please let me know what this is for?\n• Is this a *cake design* you'd like us to create?\n• Or something else?`
      : clarificationMsg;

    await sendWhatsAppMessage(phone, finalMsg);
    await saveOutgoingMessage(session.id, finalMsg);

    // Update context to mark clarification sent
    await updateSessionCustomCakeContext(session.id, {
      awaiting_clarification: true,
    });

    return true; // Clarification sent
  }

  return false; // No clarification needed yet
}

/**
 * Alias for processMessage - used by webjsHandler
 * Keeping separate name for clarity in imports
 */
export const processMessageForWebJS = processMessage;
