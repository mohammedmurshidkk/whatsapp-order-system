import { Request, Response } from 'express';
import { WhatsAppWebhookBody, TestMessageRequest, SessionItem, MenuAddon, Session } from '../types';
import { findOrCreateCustomer } from '../services/customerService';
import { classifyIntent, buildSessionState, logTierUsage } from '../services/intentClassifier';
import { buildSmartContext, handleTier1Intent } from '../services/contextBuilder';
import { getCachedAIResponse, setCachedAIResponse, getCachedGreeting, setCachedGreeting } from '../services/cacheService';
import {
  findOrCreateSession,
  updateSessionActivity,
  getSessionWithItems,
  isAIPaused,
  updateSessionItemCustomText,
  updateSessionLanguage,
  getSessionLanguage,
  setLastAddedItem,
  setPendingCustomText,
  setPendingAddonSelection,
  setPendingDateSelection,
  setPendingCustomDate,
  updateSessionPendingState,
  clearSessionPendingState,
} from '../services/sessionService';
import {
  getRecentMessages,
  saveIncomingMessage,
  saveOutgoingMessage,
  saveIncomingMediaMessage,
} from '../services/messageService';
import { processIncomingMedia } from '../services/mediaService';
import { processMessageWithAI, classifyCustomTextResponse, classifyImageWithGemini } from '../services/aiService';
import {
  normalizeManglish,
  containsMalayalamScript,
  isManglishMessage,
} from '../plugins/cake-cafe/services/manglishService';
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
} from '../plugins/cake-cafe/services/orderService';
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
} from '../plugins/cake-cafe/services/menuService';
import {
  getBusinessOutlets,
  formatOutletsForCustomer,
  findOutletByCustomerInput,
} from '../plugins/cake-cafe/services/outletService';
import { getPopularItemsForAI } from '../plugins/cake-cafe/services/popularItemsService';
import {
  updateSessionFulfillmentType,
  updateSessionDeliveryInfo,
  updateSessionPickupInfo,
  parseDeliveryTime,
  parseDeliveryTimeSmart,
  extractAddressAndTime,
  formatDeliveryTime,
  calculateDateTimeFromButtons,
  validateOperatingHours,
  calculateDistanceBasedDeliveryFee,
} from '../plugins/cake-cafe/services/fulfillmentService';
import {
  getAutoSuggestedAddons,
  addAddonToSessionItem,
  formatAddonsForCustomer,
  findAddonByCustomerInput,
  findMultipleAddonsByInput,
  removeAddonFromSession,
  getAddonsByIds,
} from '../plugins/cake-cafe/services/addonService';
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
  trackInboundMessage,
} from '../services/whatsapp';
import { getAmenityBySlug, getBusinessAmenities } from '../plugins/cake-cafe/services/amenityService';
import { getMenuPdfUrl, menuPdfExists } from '../plugins/cake-cafe/services/pdfService';
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
} from '../plugins/cake-cafe/services/cakeQuoteService';
import { getFullPricingConfig } from '../plugins/cake-cafe/services/cakePricingService';
import {
  isValidPhoneNumber,
  sanitizePhoneNumber,
  isValidMessage,
  sanitizeMessage,
} from '../utils/validators';
import { logger } from '../utils/logger';
import {
  createIntervention,
  resolveIntervention,
} from '../plugins/cake-cafe/services/interventionService';
import { emitInterventionCreated } from '../services/socketService';
import { getActiveMenuPdfConfigs, getMenuPdfConfigBySlug, getLocalizedMenuName } from '../plugins/cake-cafe/services/menuPdfConfigService';
import {
  updateSessionCustomCakeContext,
  clearSessionCustomCakeContext,
  pauseAI
} from '../services/sessionService';
import { SupportedLanguage, detectLanguageRequest, t } from '../i18n';
import { hasHandler } from '../plugins/cake-cafe/handlers/registry';
import { ConversationContext, getPluginForBusiness } from '../plugins';
// IntentContext is now built inside plugin.handleIntent

const CAKE_KEYWORDS = ['cake', 'birthday', 'anniversary', 'kg', 'flavor', 'chocolate', 'vanilla', 'fondant', 'design', 'custom'];

/**
 * Format available flavors from pricing config for display
 * Returns string like "\n\nAvailable flavors: Chocolate, Vanilla, Red Velvet"
 */
async function formatAvailableFlavors(businessId: string, lang: 'en' | 'ml'): Promise<string> {
  try {
    const pricingConfig = await getFullPricingConfig(businessId);
    if (!pricingConfig.flavorsGrouped || pricingConfig.flavorsGrouped.length === 0) {
      return '';
    }

    const flavorNames = pricingConfig.flavorsGrouped.map(f => f.flavor_name);
    const prefix = lang === 'ml' ? '\n\nലഭ്യമായ ഫ്ലേവറുകൾ: ' : '\n\nAvailable flavors: ';
    return prefix + flavorNames.join(', ');
  } catch (error) {
    logger.warn('Failed to get flavors for formatting', error);
    return '';
  }
}

// Track last added item per session for add-on attachment
// Moved to database: last_added_item_id

// Track pending custom text questions per session
// Moved to database: pending_state.pendingCustomText

// Track pending addon selections per session
// Moved to database: pending_state.pendingAddonSelection

// Track pending date selection for time button flow (date selected, waiting for time)
// Moved to database: pending_state.pendingDateSelection

// Track pending custom date when user sends date and time separately (e.g., "14/01/26" then "11am")
// Moved to database: pending_state.pendingCustomDate

// Helper: Check if text is date-only (DD/MM/YY or DD/MM/YYYY without time)
function isDateOnly(text: string): { year: number; month: number; day: number } | null {
  const normalized = text.toLowerCase().trim();

  // Try DD/MM/YY or DD/MM/YYYY format first
  const dateMatchWithYear = normalized.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dateMatchWithYear) {
    const day = parseInt(dateMatchWithYear[1], 10);
    const month = parseInt(dateMatchWithYear[2], 10) - 1; // JS months are 0-indexed
    let year = parseInt(dateMatchWithYear[3], 10);
    if (year < 100) year += 2000;
    return { year, month, day };
  }

  // Try DD/MM format without year (e.g., "25/1", "14-01")
  const dateMatchNoYear = normalized.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (dateMatchNoYear) {
    const day = parseInt(dateMatchNoYear[1], 10);
    const month = parseInt(dateMatchNoYear[2], 10) - 1; // JS months are 0-indexed
    const now = new Date();
    let year = now.getFullYear();

    // If the date has passed this year, use next year
    const targetDate = new Date(year, month, day);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (targetDate < today) {
      year = year + 1;
    }

    return { year, month, day };
  }

  return null;
}

// Helper: Check if text is time-only (e.g., "11am", "3:30pm", "evening")
function isTimeOnly(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  // Exclude if it has a date pattern
  if (/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(normalized)) return false;
  // Check for time patterns
  const timePatterns = [
    /^\d{1,2}(?::\d{2})?\s*(am|pm)$/i,  // 11am, 3:30pm
    /^(morning|evening|afternoon|ravile|vaikunneram|uchakku)$/i,  // Time words
    /^\d{1,2}:\d{2}$/,  // 14:30
  ];
  return timePatterns.some(p => p.test(normalized));
}

// Helper: Combine pending date with time-only input
function combineDateAndTime(pendingDate: { year: number; month: number; day: number }, timeText: string, timezone: string): string | null {
  // Convert to DD/MM/YYYY format and append time
  const combinedText = `${pendingDate.day}/${pendingDate.month + 1}/${pendingDate.year} ${timeText}`;
  return parseDeliveryTime(combinedText, timezone);
}

// Message debounce buffer - waits for user to finish typing before processing
interface PendingMessage {
  messages: string[];
  businessId: string;
  customerName?: string;
  timer: NodeJS.Timeout;
}
const messageDebounceMap = new Map<string, PendingMessage>(); // phone -> pending messages

const DEBOUNCE_DELAY_MS = 0; // Wait 10 seconds for more messages

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
    if (reply) {
      await sendWhatsAppMessage(phone, reply, pending.businessId);
    }
  } catch (error) {
    logger.error('Error processing debounced messages', error);
    try {
      const customer = await findOrCreateCustomer(phone, pending.businessId, pending.customerName);
      const { session } = await findOrCreateSession(customer.id, pending.businessId);
      const lang: SupportedLanguage = getSessionLanguage(session);
      await sendWhatsAppMessage(phone, t('error.generic', lang), pending.businessId);
    } catch (langError) {
      logger.error('Could not get session language for error message', langError);
      // Fallback to default language
      await sendWhatsAppMessage(phone, t('error.generic', 'en'), pending.businessId);
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
): Promise<string | null | undefined> {
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

  // Helper functions with businessId pre-bound for usage tracking
  const sendReply = (to: string, msg: string) => sendWhatsAppMessage(to, msg, businessId);
  const sendButtons = (to: string, body: string, btns: { id: string; title: string }[]) => sendReplyButtons(to, body, btns, businessId);
  const sendList = (to: string, hdr: string, body: string, btnTxt: string, sections: any[]) => sendInteractiveListMessage(to, hdr, body, btnTxt, sections, businessId);
  const sendLocation = (to: string, body: string) => sendLocationRequest(to, body, businessId);
  const sendDoc = (to: string, url: string, name: string, caption?: string) => sendDocument(to, url, name, caption, businessId);
  const sendImg = (to: string, url: string, caption?: string) => sendImage(to, url, caption, businessId);

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
    // Save the incoming message that triggered the new session
    await saveIncomingMessage(session.id, originalMessage);

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

    await sendButtons(phone, welcomeMsg, menuButtons);
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

  // 3. Check if user is responding with weight/flavor after sending cake image first
  if (session.custom_cake_context?.inquiry_type === 'image_first' && session.custom_cake_context?.image_url) {
    // Extract weight/flavor from message
    const extractedWeight = messageText.match(/(\d+(?:\.\d+)?\s*(?:kg|g|lb|pound)s?)/i)?.[1];
    const extractedFlavor = messageText.match(/(chocolate|vanilla|strawberry|red velvet|butterscotch|black forest|truffle|mango|pineapple|blueberry|oreo)/i)?.[0];

    if (extractedWeight || extractedFlavor) {
      logger.info(`User provided weight/flavor for image_first flow: weight=${extractedWeight}, flavor=${extractedFlavor}`);

      // Save the message before processing
      await saveIncomingMessage(session.id, originalMessage);

      const imageUrl = session.custom_cake_context.image_url;
      await clearSessionCustomCakeContext(session.id);

      await processCustomCakeWithIntervention(
        businessId,
        session.id,
        customer.id,
        phone,
        imageUrl,
        extractedWeight,
        extractedFlavor
      );
      return null; // Handled by intervention
    }
  }

  // Check for pending custom text question (e.g., "What to write on cake?")
  const pendingCustomText = session.pending_state?.pendingCustomText;
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
      await setPendingCustomText(session.id, null);
      await saveIncomingMessage(session.id, originalMessage);

      // Check if there are pending addons to ask about (stored when custom text was first asked)
      const pendingAddonStateAfterSkip = session.pending_state?.pendingAddonSelection;
      if (pendingAddonStateAfterSkip && pendingAddonStateAfterSkip.itemId === pendingCustomText.itemId) {
        // Ask about addons now
        const addons = await getAddonsByIds(pendingAddonStateAfterSkip.addonIds);
        const addonsMessage = formatAddonsForCustomer(addons);
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
      await setPendingCustomText(session.id, null);
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
        await setPendingCustomText(session.id, null);
        await saveIncomingMessage(session.id, originalMessage);

        // Check for pending addons
        const pendingAddonStateAfterSkip = session.pending_state?.pendingAddonSelection;
        if (pendingAddonStateAfterSkip && pendingAddonStateAfterSkip.itemId === pendingCustomText.itemId) {
          // Ask about addons now
          const addons = await getAddonsByIds(pendingAddonStateAfterSkip.addonIds);
          const addonsMessage = formatAddonsForCustomer(addons);
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
        await setPendingCustomText(session.id, null);

        // Save incoming message
        await saveIncomingMessage(session.id, originalMessage);

        // Check if there are pending addons to ask about (stored when custom text was first asked)
        const pendingAddonStateAfterText = session.pending_state?.pendingAddonSelection;
        if (pendingAddonStateAfterText && pendingAddonStateAfterText.itemId === pendingCustomText.itemId) {
          // Ask about addons now
          const addons = await getAddonsByIds(pendingAddonStateAfterText.addonIds);
          const addonsMessage = formatAddonsForCustomer(addons);
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
  const pendingAddonState = session.pending_state?.pendingAddonSelection;
  if (pendingAddonState && !isCustomTextQuestion) {
    const addons = await getAddonsByIds(pendingAddonState.addonIds);
    const pendingAddon = { ...pendingAddonState, addons };
    const normalizedInput = messageText.toLowerCase().trim();

    // Check if user wants to skip addons
    if (['no', 'no thanks', 'skip', 'none', 'nope', 'nothing'].some(s => normalizedInput === s || normalizedInput.startsWith(s + ' '))) {
      logger.info(`Customer declined addons for item ${pendingAddon.itemId}`);
      await setPendingAddonSelection(session.id, null);

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
        await setPendingCustomText(session.id, {
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
      await setPendingAddonSelection(session.id, null);

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
      await setPendingAddonSelection(session.id, null);
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
      // Check if message is a date-only input (e.g., "14/1/26") - store for combining with time later
      const dateOnlyInputEarly = isDateOnly(messageText);
      if (dateOnlyInputEarly) {
        await setPendingCustomDate(session.id, {
          ...dateOnlyInputEarly,
          fulfillmentType: sessionForTimeCheck.fulfillment_type || undefined,
        });
        logger.info(`📅 Stored pending custom date (early): ${dateOnlyInputEarly.day}/${dateOnlyInputEarly.month + 1}/${dateOnlyInputEarly.year} for session ${session.id}`);
        // Save message and ask for time
        await saveIncomingMessage(session.id, originalMessage);
        const timePromptMsg = t('fulfillment.askTime', lang);
        await saveOutgoingMessage(session.id, timePromptMsg);
        return timePromptMsg;
      }

      // Check if message looks like a time input (includes Malayalam words: inn/innu=today, nale=tomorrow)
      const looksLikeTime = /\d{1,2}(?:[:\d]{2})?\s*(?:am|pm)|morning|evening|afternoon|today|tomorrow|nale|inn|innu|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|in\s+\d+(?:\.\d+)?\s*(?:hour|hr|minute|min)/i.test(messageText);

      if (looksLikeTime) {
        logger.info(`Session needs time, parsing: "${messageText}"`);

        // Check if there's a pending custom date (user sent date and time separately)
        const pendingCustomDate = session.pending_state?.pendingCustomDate;
        let parsedTime: string | null = null;

        if (pendingCustomDate && isTimeOnly(messageText)) {
          // Combine pending date with time-only input
          parsedTime = combineDateAndTime(pendingCustomDate, messageText, businessTimezone);
          logger.info(`📅 Combined pending date with time: ${messageText} -> ${parsedTime}`);
          await setPendingCustomDate(session.id, null);
        } else {
          // Use AI-powered smart parser for complex/multilingual date inputs
          parsedTime = await parseDeliveryTimeSmart(messageText, businessTimezone);
        }

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
          await setLastAddedItem(session.id, customCakeItem.id);

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
            await sendButtons(phone, quoteAcceptedReply, [
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

  // Use sessionWithItems for LATEST fulfillment data
  const latestSessionData = sessionWithItems || session;

  // ============================================
  // RAG Level 2: Intent Classification & Smart Context
  // ============================================

  // Build session state for intent classification
  const fulfillmentComplete = !!latestSessionData.fulfillment_type &&
    (!!latestSessionData.delivery_address || !!latestSessionData.pickup_outlet_id);

  const sessionState = buildSessionState(session, existingItems, fulfillmentComplete);

  // Classify intent to determine processing tier
  const classified = classifyIntent(messageText, sessionState, business);
  logger.debug(`Intent classified: tier=${classified.tier}, intent=${classified.intent}, skipAI=${classified.skipAI}`);

  // TIER 0: Cached/template responses - no AI needed
  if (classified.tier === 0 && classified.skipAI && classified.cachedResponse) {
    // Check if we have a cached greeting for this business
    if (classified.intent === 'greeting' && businessId) {
      const cachedGreeting = await getCachedGreeting(businessId);
      if (cachedGreeting) {
        await saveIncomingMessage(session.id, originalMessage);
        await saveOutgoingMessage(session.id, cachedGreeting);
        logTierUsage(0, classified.intent, false, businessId);
        return cachedGreeting;
      }
      // Cache the greeting for next time
      await setCachedGreeting(businessId, classified.cachedResponse);
    }

    await saveIncomingMessage(session.id, originalMessage);
    await saveOutgoingMessage(session.id, classified.cachedResponse);
    logTierUsage(0, classified.intent, false, businessId);
    return classified.cachedResponse;
  }

  // TIER 1: DB lookup responses - no AI needed
  if (classified.tier === 1 && classified.skipAI) {
    const tier1Response = await handleTier1Intent(classified.intent, businessId, business);
    if (tier1Response) {
      await saveIncomingMessage(session.id, originalMessage);
      await saveOutgoingMessage(session.id, tier1Response);
      logTierUsage(1, classified.intent, false, businessId);
      return tier1Response;
    }
    // Fall through to AI if no tier 1 response
  }

  // TIER 2/3: Check AI response cache first
  if (classified.tier >= 2) {
    const cachedResponse = await getCachedAIResponse(businessId, messageText);
    if (cachedResponse) {
      await saveIncomingMessage(session.id, originalMessage);
      await saveOutgoingMessage(session.id, cachedResponse);
      logTierUsage(classified.tier, 'cached_ai', false, businessId);
      return cachedResponse;
    }
  }

  // Build smart context based on tier (only loads relevant data)
  const aiContext = await buildSmartContext({
    message: messageText,
    businessId,
    business,
    session: latestSessionData,
    cartItems: existingItems,
    language: lang,
    tier: classified.tier,
    activeOrder: activeOrder ? {
      order_number: activeOrder.order_number,
      status: activeOrder.status,
      total_amount: activeOrder.total_amount,
      fulfillment_type: activeOrder.fulfillment_type,
      created_at: activeOrder.created_at,
    } : null,
  });

  // Add outlets if not already included (needed for fulfillment flow)
  if (!aiContext.outlets) {
    aiContext.outlets = outlets;
  }

  logger.debug(`Smart context built: type=${aiContext.contextType}, menuItems=${aiContext.menuItems?.length || 0}, keywords=${aiContext.keywords?.join(',') || 'none'}`);
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
      await sendButtons(phone, datePrompt, [
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

  // Log tier usage for cost tracking
  logTierUsage(classified.tier, aiResponse.intent || classified.intent, true, businessId);

  // Cache non-transactional AI responses for future use
  // Don't cache: order confirmations, cart modifications, fulfillment collection
  const nonCacheableIntents = ['confirm_order', 'add_item', 'modify_order', 'remove_addon',
    'collect_delivery_info', 'collect_pickup_info', 'ready_for_checkout', 'cancel'];
  if (!nonCacheableIntents.includes(aiResponse.intent) && aiResponse.reply) {
    // Cache with 30 min TTL for simple queries
    await setCachedAIResponse(businessId, messageText, aiResponse.reply, 1800);
  }

  // Save incoming message (use original, not normalized, to preserve customer's actual input)
  await saveIncomingMessage(session.id, originalMessage);

  let replyMessage = aiResponse.reply;
  let intentToProcess = aiResponse.intent;

  // ============================================
  // HANDLE: Date-only and time-only inputs sent separately
  // E.g., user sends "14/01/26" then "11am" as separate messages
  // ============================================
  const dateOnlyInput = isDateOnly(messageText);
  if (dateOnlyInput) {
    // Store the date for combining with time in next message
    await setPendingCustomDate(session.id, {
      ...dateOnlyInput,
      fulfillmentType: latestSessionData.fulfillment_type || undefined,
    });
    logger.info(`📅 Stored pending custom date: ${dateOnlyInput.day}/${dateOnlyInput.month + 1}/${dateOnlyInput.year} for session ${session.id}`);
    // Continue with AI response (likely asks "what time?")
  }

  // Check if user sent time-only and we have a pending custom date
  const pendingCustomDateInt = session.pending_state?.pendingCustomDate;
  if (pendingCustomDateInt && isTimeOnly(messageText)) {
    // Combine pending date with time
    const combinedTime = combineDateAndTime(pendingCustomDateInt, messageText, businessTimezone);
    if (combinedTime) {
      logger.info(`📅 Combined pending date with time: ${messageText} -> ${combinedTime}`);
      // Update AI response's delivery_time with combined datetime
      if (aiResponse.fulfillment) {
        aiResponse.fulfillment.delivery_time = combinedTime;
      } else {
        aiResponse.fulfillment = { delivery_time: combinedTime };
      }
    }
    // Clear pending date after use
    await setPendingCustomDate(session.id, null);
  }

  // SERVER-SIDE: Detect custom text change requests (e.g., "change text to Happy Birthday")
  const customTextChangeMatch = messageText.match(/(?:change|update|make it|write)\s*(?:the\s*)?(?:text|message|writing)?\s*(?:to|into|as)?\s*["']?(.+?)["']?\s*$/i);
  if (customTextChangeMatch && existingItems.length > 0) {
    const newCustomText = customTextChangeMatch[1].replace(/^["']|["']$/g, '').trim();
    if (newCustomText.length > 2) {
      const lastItemId = session.last_added_item_id;
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
        await setLastAddedItem(session.id, customCakeItem.id);

        // Generate summary and ask for fulfillment
        const summary = await generateOrderSummary(session.id, { includeCta: false, timezone: business?.timezone || 'Asia/Kolkata' });

        let fallbackReply: string;
        if (business?.supports_delivery && business?.supports_takeaway) {
          fallbackReply = t('customCake.addedThenAskFulfillment', lang, { summary });
          await saveOutgoingMessage(session.id, fallbackReply);
          await sendButtons(phone, fallbackReply, [
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

  // ============================================
  // BUILD PLUGIN CONTEXT & EXECUTE HANDLER
  // ============================================
  // Get plugin for this business (defaults to food-ordering)
  const plugin = getPluginForBusiness(business || {});

  // Build ConversationContext for plugin
  const conversationContext: ConversationContext = {
    // Core entities
    session,
    sessionWithItems: sessionWithItems!,
    customer,
    business: business!,

    // Message data
    message: messageText,
    originalMessage,
    aiResponse,
    language: lang,

    // Phone for messaging
    phone,
    businessTimezone,
    isFirstMessage,

    // Menu & content
    menu: menuItems || [],
    categories: menuCategories || [],
    addons: [] as any[], // Addons loaded on-demand by handlers
    outlets,
    cartItems: existingItems,
    amenities: amenities || [],
    activeOrder,

    // Messaging helpers
    messaging: {
      sendWhatsAppMessage: sendReply,
      sendButtons,
      sendList,
      sendLocation,
      sendDoc,
      sendImage: sendImg,
      saveOutgoingMessage,
      saveIncomingMessage,
    },
  };

  // Execute handler via plugin
  let messageSaved = false;
  if (hasHandler(intentToProcess)) {
    const result = await plugin.handleIntent(intentToProcess, conversationContext);
    if (result) {
      if (!result.skipResponse) {
        replyMessage = result.response;
      } else {
        // Handler sent custom message (buttons, list, etc.) - return null
        return null;
      }
    }
  }
  // If no handler or handler didn't change reply, use AI's reply as is (smalltalk, etc.)

  // Save outgoing message (skip if handler already saved it)
  if (!messageSaved) {
    await saveOutgoingMessage(session.id, replyMessage);
  }

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

        // Helper functions with businessId pre-bound for usage tracking (webhook level)
        const wbSendReply = (to: string, msg: string) => sendWhatsAppMessage(to, msg, business.id);
        const wbSendButtons = (to: string, body: string, btns: { id: string; title: string }[]) => sendReplyButtons(to, body, btns, business.id);
        const wbSendList = (to: string, hdr: string, body: string, btnTxt: string, sections: any[]) => sendInteractiveListMessage(to, hdr, body, btnTxt, sections, business.id);
        const wbSendLocation = (to: string, body: string) => sendLocationRequest(to, body, business.id);
        const wbSendDoc = (to: string, url: string, name: string, caption?: string) => sendDocument(to, url, name, caption, business.id);
        const wbSendImg = (to: string, url: string, caption?: string) => sendImage(to, url, caption, business.id);

        // Get business timezone for date/time handling
        const businessTimezone = business.timezone || 'Asia/Kolkata';

        // Extract customer name from WhatsApp contacts
        const customerName = value.contacts?.[0]?.profile?.name || undefined;
        if (customerName) {
          logger.info(`WhatsApp customer name: ${customerName}`);
        }

        for (const message of value.messages) {
          const phone = sanitizePhoneNumber(message.from);

          // Track inbound message for usage stats
          const msgType = message.type === 'image' ? 'image' :
            message.type === 'document' ? 'document' :
              message.type === 'location' ? 'location' :
                message.type === 'interactive' ? 'interactive' : 'text';
          trackInboundMessage(business.id, msgType as any);

          // Mark message as read immediately (shows blue checkmarks to sender)
          if (message.id) {
            markAsRead(message.id, business.id).catch(() => { });
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
              // 1. Get current context and language
              const context = session.custom_cake_context;
              const lang = getSessionLanguage(session);

              // CASE 1: Already awaiting image (text inquiry came first)
              // User already asked about custom cakes, so we don't need to ask again
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

              // CASE 3: Classify image using Gemini Vision to determine what it is
              logger.info(`Classifying image for session ${session.id}`);

              let classification: Awaited<ReturnType<typeof classifyImageWithGemini>> | null = null;

              if (imageBuffer) {
                try {
                  const menuItems = await getMenuItems(business.id);
                  const menuItemNames = menuItems.map(item => item.name);
                  const imageBase64 = imageBuffer.toString('base64');

                  classification = await classifyImageWithGemini(imageBase64, imageMimeType, menuItemNames);
                  logger.info(`Image classification result: ${classification.classification} (${Math.round(classification.confidence * 100)}% confidence)`);
                } catch (error) {
                  logger.warn('Image classification failed, falling back to clarification', error);
                }
              }

              // CASE 3a: Classified as cake_design - ask for weight/flavor (don't ask if custom cake again!)
              if (classification?.isCake || classification?.classification === 'cake_design') {
                logger.info(`Image classified as cake design - asking for weight/flavor`);

                // Store image URL in context for later use
                await updateSessionCustomCakeContext(session.id, {
                  image_url: imageUrl,
                  awaiting_image: false,
                  inquiry_type: 'image_first',
                });

                // Get available flavors
                const availableFlavorsText = await formatAvailableFlavors(business.id, lang);

                // Ask for weight and flavor (image already received!)
                let askWeightFlavorMsg = t('customCake.askWeightFlavor', lang, { flavors: availableFlavorsText });
                if (!askWeightFlavorMsg || askWeightFlavorMsg.includes('customCake.')) {
                  askWeightFlavorMsg = `Nice design! 🎂\n\nPlease let us know:\n• Weight (e.g., 1kg, 2kg)\n• Flavor${availableFlavorsText}`;
                }

                await wbSendReply(phone, askWeightFlavorMsg);
                await saveOutgoingMessage(session.id, askWeightFlavorMsg);
                continue;
              }

              // CASE 3b: Classified as menu_screenshot - try to identify the item
              if (classification?.classification === 'menu_screenshot' && classification.detectedItemName) {
                logger.info(`Image classified as menu screenshot - detected item: ${classification.detectedItemName}`);

                // Try to find the item in menu
                const menuItems = await getMenuItems(business.id);
                const matchedItem = menuItems.find(item =>
                  item.name.toLowerCase().includes(classification!.detectedItemName!.toLowerCase()) ||
                  classification!.detectedItemName!.toLowerCase().includes(item.name.toLowerCase())
                );

                if (matchedItem) {
                  const confirmMsg = lang === 'ml'
                    ? `"${matchedItem.name}" ഓർഡർ ചെയ്യണോ? 🛒`
                    : `Would you like to order "${matchedItem.name}"? 🛒`;
                  await wbSendReply(phone, confirmMsg);
                  await saveOutgoingMessage(session.id, confirmMsg);
                  continue;
                }
              }

              // CASE 4: No context and not clearly a cake - ask for clarification
              logger.info(`Image not classified as cake - storing pending state for session ${session.id}`);

              // Store pending state with actual image URL
              await updateSessionCustomCakeContext(session.id, {
                pending_image_id: message.image.id,
                pending_image_timestamp: new Date().toISOString(),
                image_url: imageUrl,
                awaiting_clarification: false,
              });

              // If it looks like a food photo (not cake), ask clarification immediately
              if (classification?.classification === 'food_photo' || classification?.classification === 'other') {
                const clarificationMsg = t('image.askContext', lang);
                const finalMsg = (!clarificationMsg || clarificationMsg.includes('image.'))
                  ? `I received your image! 📸\n\nCould you please let me know what this is for?\n\n• Is this a *cake design* you'd like us to create?\n• Or something else?`
                  : clarificationMsg;

                await wbSendReply(phone, finalMsg);
                await saveOutgoingMessage(session.id, finalMsg);

                await updateSessionCustomCakeContext(session.id, {
                  pending_image_id: message.image.id,
                  pending_image_timestamp: new Date().toISOString(),
                  image_url: imageUrl,
                  awaiting_clarification: true,
                });
              }

              // Don't reply yet if classification unclear - wait for follow-up (30s check in processMessage)
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
              await wbSendReply(phone, videoResponse);
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
              await wbSendReply(phone, docResponse);
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
              await wbSendReply(phone, notEnabledReply);
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
              await wbSendReply(phone, noSpeechReply);
              await saveOutgoingMessage(session.id, noSpeechReply);
              continue;
            }

            try {
              // Transcribe voice message (pass businessId for credential lookup)
              const transcription = await processVoiceMessage(audioId!, business.id);
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
                await sendWhatsAppMessage(phone, voiceReply, business.id);
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
              await wbSendReply(phone, errorReply);
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
                logger.info(`[DEBUG-LOC] Step 7: Saving lat/long and geocoded address, will ask for full address...`);
                await updateSessionDeliveryInfo(session.id, {
                  address: null, // Will be filled by user with house name/landmark
                  geocoded_address: displayAddress, // Save WhatsApp geocoded address for reference
                  latitude: location.latitude,
                  longitude: location.longitude,
                });
                logger.info(`[DEBUG-LOC] Step 7 done (geocoded_address=${displayAddress})`);

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

                  // Create intervention for admin dashboard
                  const { createIntervention } = await import('../plugins/cake-cafe/services/interventionService');
                  await createIntervention(
                    business.id,
                    session.id,
                    customer.id,
                    'out_of_radius',
                    {
                      phone: phone,
                      distance_km: (deliveryFeeResult.distance_meters / 1000).toFixed(1),
                      address: displayAddress || 'Location shared',
                      latitude: location.latitude,
                      longitude: location.longitude,
                      suggested_fee: deliveryFeeResult.suggested_fee || 0, // Auto-fill for admin
                    }
                  );

                  // Pause AI for admin to handle out-of-radius approval
                  await pauseAI(session.id, 'Out of delivery radius - awaiting admin approval');

                  // Inform customer
                  const lang = getSessionLanguage(session);
                  const beyondRadiusMsg = t('fulfillment.beyondArea', lang, { distance: `${(deliveryFeeResult.distance_meters / 1000).toFixed(1)}km` });
                  await wbSendReply(phone, beyondRadiusMsg);
                  await saveOutgoingMessage(session.id, beyondRadiusMsg);
                  logger.info(`[DEBUG-LOC] Beyond radius - pending approval set for session ${session.id}`);
                  continue;
                }

                // Ask for full address with landmark (lat/long saved, need human-readable address)
                logger.info(`[DEBUG-LOC] Step 8: Asking for full address with landmark...`);
                const lang = getSessionLanguage(session);
                const askAddressPrompt = t('fulfillment.locationSavedAskFullAddress', lang);
                await wbSendReply(phone, askAddressPrompt);
                await saveOutgoingMessage(session.id, askAddressPrompt);
                logger.info(`[DEBUG-LOC] Step 8 done - waiting for full address`);
              } else {
                // Not in delivery flow yet OR already has location - still save it for later use
                logger.info(`[DEBUG-LOC] Step 9: Saving location for future use...`);

                // Save location to session (will be used when user chooses delivery later)
                await updateSessionDeliveryInfo(session.id, {
                  address: displayAddress, // Can be null if geocoding failed
                  geocoded_address: displayAddress, // Also save as geocoded for reference
                  latitude: location.latitude,
                  longitude: location.longitude,
                });
                logger.info(`[DEBUG-LOC] Step 9: Location saved (lat=${location.latitude}, long=${location.longitude}, addr=${displayAddress || 'NULL'})`);

                const lang = getSessionLanguage(session);
                const locationReply = t('fulfillment.locationSavedForLater', lang);
                await wbSendReply(phone, locationReply);
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
                  await wbSendList(
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
                await wbSendLocation(phone, deliveryPrompt);
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
                      await wbSendDoc(
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
                      await wbSendDoc(phone, pdfUrl, `${business.name}_Menu.pdf`, pdfCaption);
                      await saveOutgoingMessage(session.id, `[Menu PDF sent]`);
                      continue;
                    }
                  }
                }

                // Fallback to interactive menu list
                const menuCategories = await getMenuCategories(business.id);
                const categorySections = buildCategoryListSections(menuCategories);
                if (categorySections.length > 0 && categorySections[0].rows.length > 0) {
                  await wbSendList(
                    phone,
                    t('menu.ourMenu', lang),
                    t('menu.welcome', lang, { businessName: business.name }),
                    t('menu.browseBtn', lang),
                    categorySections
                  );
                  await saveOutgoingMessage(session.id, `[Interactive menu sent]`);
                } else {
                  await wbSendReply(phone, t('menu.fallback', lang));
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
                  await wbSendDoc(
                    phone,
                    menuConfig.pdf_url,
                    `${localizedName}.pdf`,
                    localizedName // Caption in user's language
                  );
                  await saveOutgoingMessage(session.id, `[Sent ${localizedName} PDF]`);
                } else {
                  // Fallback if config not found
                  await wbSendReply(phone, t('menu.fallback', lang));
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
                    await wbSendReply(phone, addedMsg);
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
                  await setPendingDateSelection(session.id, { date: 'today', fulfillmentType });
                  await saveIncomingMessage(session.id, `[Selected: ${t('buttons.today', lang)}]`);

                  // Different time options for delivery vs takeaway
                  const timePrompt = t('buttons.whatTime', lang, { date: `*${t('buttons.today', lang)}*` });
                  await saveOutgoingMessage(session.id, timePrompt);

                  if (isDelivery) {
                    // Delivery: In 1 hour, In 1.5 hours, Other
                    await wbSendButtons(phone, timePrompt, [
                      { id: 'time_1hour', title: '🕐 In 1 hour' },
                      { id: 'time_1_5hour', title: '🕐 In 1.5 hours' },
                      { id: 'time_other', title: `⏰ ${t('buttons.other', lang)}` },
                    ]);
                  } else {
                    // Takeaway: In 30 min, In 1 hour, Other
                    await wbSendButtons(phone, timePrompt, [
                      { id: 'time_30min', title: '🕐 In 30 min' },
                      { id: 'time_1hour', title: '🕐 In 1 hour' },
                      { id: 'time_other', title: `⏰ ${t('buttons.other', lang)}` },
                    ]);
                  }
                  continue;
                }

                if (buttonId.includes('_tomorrow_')) {
                  // Store date selection and show time buttons for tomorrow
                  await setPendingDateSelection(session.id, { date: 'tomorrow', fulfillmentType });
                  await saveIncomingMessage(session.id, `[Selected: ${t('buttons.tomorrow', lang)}]`);

                  const timePrompt = t('buttons.whatTime', lang, { date: `*${t('buttons.tomorrow', lang)}*` });
                  await saveOutgoingMessage(session.id, timePrompt);

                  // Tomorrow: Morning, Afternoon, Other
                  await wbSendButtons(phone, timePrompt, [
                    { id: 'time_morning', title: '🌅 Morning (10 AM)' },
                    { id: 'time_afternoon', title: '🌞 Afternoon (2 PM)' },
                    { id: 'time_other', title: `⏰ ${t('buttons.other', lang)}` },
                  ]);
                  continue;
                }

                if (buttonId.includes('_other_')) {
                  // User wants to specify custom date/time - fall back to text input
                  await setPendingDateSelection(session.id, null);
                  await saveIncomingMessage(session.id, `[Selected: ${t('buttons.other', lang)}]`);

                  const customPrompt = t('buttons.customTimePrompt', lang);
                  await wbSendReply(phone, customPrompt);
                  await saveOutgoingMessage(session.id, customPrompt);
                  continue;
                }
              }

              // Handle TIME selection buttons
              if (buttonId.startsWith('time_')) {
                const customer = await findOrCreateCustomer(phone, business.id, customerName);
                const { session } = await findOrCreateSession(customer.id, business.id);
                const sessionWithItems = await getSessionWithItems(session.id);
                const pendingDate = session.pending_state?.pendingDateSelection;
                const lang = getSessionLanguage(session);

                if (buttonId === 'time_other') {
                  // User wants custom time - fall back to text input
                  await setPendingDateSelection(session.id, null);
                  await saveIncomingMessage(session.id, `[Selected: ${t('buttons.other', lang)}]`);

                  const dateText = pendingDate?.date === 'tomorrow' ? t('buttons.tomorrow', lang) : t('buttons.today', lang);
                  const customPrompt = t('buttons.customTimePromptForDate', lang, { date: dateText });
                  await wbSendReply(phone, customPrompt);
                  await saveOutgoingMessage(session.id, customPrompt);
                  continue;
                }

                // Calculate actual datetime from button selection
                const dateSelection = pendingDate?.date || 'today';
                const calculatedTime = calculateDateTimeFromButtons(dateSelection, buttonId, businessTimezone);

                if (!calculatedTime) {
                  logger.error(`Failed to calculate time for: ${dateSelection} ${buttonId}`);
                  await wbSendReply(phone, t('time.calculationError', lang));
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
                  await setPendingDateSelection(session.id, null);

                  // Tell customer to wait for confirmation
                  const timeConfirmMsg = t('customCake.timeConfirmRequest', lang, {
                    type: fulfillmentTypeForQuote,
                    time: calculatedTime,
                  });
                  await wbSendReply(phone, timeConfirmMsg);
                  await saveOutgoingMessage(session.id, timeConfirmMsg);
                  continue;
                }

                // ============================================
                // URGENT ORDER CHECK (BUTTON FLOW)
                // ============================================
                const minimumWaitMinutes = (business as any)?.minimum_wait_minutes;
                if (minimumWaitMinutes && minimumWaitMinutes > 0) {
                  const requestedDate = new Date(calculatedTime);
                  const now = new Date();
                  const diffMinutes = (requestedDate.getTime() - now.getTime()) / (1000 * 60);

                  // Only trigger for future times within minimum_wait_minutes
                  if (diffMinutes > 0 && diffMinutes < minimumWaitMinutes) {
                    const fulfillmentTypeForUrgent = fulfillmentType || 'takeaway';
                    logger.info(`🚨 Urgent order detected (button): ${calculatedTime} is ${Math.round(diffMinutes)} min away (min wait: ${minimumWaitMinutes})`);

                    // Skip if custom cake order (already handled above)
                    if (!acceptedQuoteForTime) {
                      // Create urgent_delivery intervention
                      const urgentIntervention = await createIntervention(
                        business.id,
                        session.id,
                        customer.id,
                        'urgent_delivery',
                        {
                          requestedTime: calculatedTime,
                          fulfillmentType: fulfillmentTypeForUrgent,
                          minimumWaitMinutes,
                          minutesUntilRequested: Math.round(diffMinutes),
                          deliveryAddress: sessionWithItems?.delivery_address,
                          outletId: sessionWithItems?.pickup_outlet_id,
                          phone,
                        }
                      );

                      if (urgentIntervention) {
                        // Pause AI
                        await pauseAI(session.id, 'Urgent order - awaiting admin confirmation');
                        // Emit socket event
                        emitInterventionCreated(business.id, urgentIntervention);

                        // Format time for display
                        const formattedTime = new Date(calculatedTime).toLocaleString('en-IN', {
                          timeZone: businessTimezone,
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        });
                        const typeLabel = fulfillmentTypeForUrgent === 'delivery'
                          ? t('fulfillment.deliveryBtn', lang)
                          : t('fulfillment.takeawayBtn', lang);

                        const waitingMsg = t('urgentOrder.waitingConfirmation', lang, { type: typeLabel, time: formattedTime });
                        await wbSendReply(phone, waitingMsg);
                        await saveOutgoingMessage(session.id, waitingMsg);

                        // Clear pending date selection
                        await setPendingDateSelection(session.id, null);
                        continue;
                      }
                    }
                  }
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
                await setPendingDateSelection(session.id, null);

                // Show final invoice
                const finalSummary = await generateOrderSummary(session.id, {
                  includeCta: true,
                  ctaMessage: `\n${t('orderSummary.reviewPrompt', lang)}`,
                  timezone: businessTimezone,
                });
                await wbSendReply(phone, finalSummary);
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
                  await wbSendList(
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
                    await wbSendList(
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
                    await wbSendButtons(phone, sizePrompt, sizeButtons);
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
                    await wbSendReply(phone, addedMsg);
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
                  await wbSendButtons(phone, datePrompt, [
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
    await sendWhatsAppMessage(phone, holdingMessage, businessId);
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

    await sendWhatsAppMessage(phone, finalMsg, businessId);
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
