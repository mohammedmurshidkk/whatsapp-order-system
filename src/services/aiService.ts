import axios from 'axios';
import { Message, AIResponse, Session, Business, MenuItem, MenuCategory, BusinessOutlet, MenuAddon, BusinessAmenity } from '../types';
import { formatMessagesForAI } from './messageService';
import { logger } from '../utils/logger';
import { getAIClient } from './aiClient';
import { formatWeight } from '../utils/weightUtils';
import { trackAIUsage, AIProvider } from './usageService';

// Helper: Add minutes to a time string (e.g., "10:00" + 30 = "10:30")
function addMinutesToTime(time: string, minutes: number): string {
  const [hours, mins] = time.split(':').map(Number);
  const totalMins = hours * 60 + mins + minutes;
  const newHours = Math.floor(totalMins / 60) % 24;
  const newMins = totalMins % 60;
  return `${String(newHours).padStart(2, '0')}:${String(newMins).padStart(2, '0')}`;
}

// Helper: Subtract minutes from a time string (e.g., "22:00" - 30 = "21:30")
function subtractMinutesFromTime(time: string, minutes: number): string {
  const [hours, mins] = time.split(':').map(Number);
  let totalMins = hours * 60 + mins - minutes;
  if (totalMins < 0) totalMins += 24 * 60; // Wrap around midnight
  const newHours = Math.floor(totalMins / 60) % 24;
  const newMins = totalMins % 60;
  return `${String(newHours).padStart(2, '0')}:${String(newMins).padStart(2, '0')}`;
}

export interface AIContext {
  business?: Business;
  menuItems?: MenuItem[];
  menuCategories?: MenuCategory[];
  currentSessionItems?: string[];
  outlets?: BusinessOutlet[];
  sessionHasFulfillmentType?: boolean;
  sessionHasDeliveryInfo?: boolean;
  sessionHasPickupInfo?: boolean;
  availableAddons?: MenuAddon[]; // NEW: Available add-ons for current item
  lastAddedItemId?: string; // NEW: Last added session item ID (for add-on flow)
  amenities?: BusinessAmenity[]; // Available amenities (party hall, etc.)
  customerLanguage?: 'en' | 'ml'; // i18n: Customer's preferred language
  // Active order context for post-order inquiries
  activeOrder?: {
    order_number: string;
    status: string;
    total_amount: number;
    fulfillment_type?: string | null;
    created_at: string;
  } | null;
}

// Format menu for AI - includes item names, sizes, AND PRICES
function formatStrictMenuForAI(items: MenuItem[], categories: MenuCategory[]): string {
  if (items.length === 0) {
    return 'MENU: No items available.';
  }

  // Build category lookup for custom weight info
  const categoryById = new Map(categories.map(c => [c.id, c]));

  // Group items by category with size and price info
  const categoryMap = new Map<string, string[]>();

  for (const item of items) {
    if (item.category_id) {
      const existing = categoryMap.get(item.category_id) || [];

      // Format item with sizes AND PRICES
      let itemText = item.name;
      if (item.sizes && item.sizes.length > 0) {
        const sizePrices = item.sizes.map(s => `${s.name}: ₹${s.price}`).join(', ');
        itemText += ` [${sizePrices}]`;
      } else if (item.price) {
        itemText += ` [₹${item.price}]`;
      }
      // Add description if available (helps AI match items by description)
      if (item.description) {
        itemText += ` - ${item.description}`;
      }

      existing.push(itemText);
      categoryMap.set(item.category_id, existing);
    }
  }

  let menuText = `AVAILABLE MENU (with prices):\n\n`;
  const customWeightCategories: string[] = [];

  // Format each category with items, sizes, and prices
  for (const category of categories) {
    const categoryItems = categoryMap.get(category.id);
    if (categoryItems && categoryItems.length > 0) {
      menuText += `${category.name}:\n`;
      categoryItems.forEach(item => {
        menuText += `  - ${item}\n`;
      });

      // Add custom weight info for enabled categories
      if (category.allows_custom_weight) {
        const minGrams = category.custom_weight_min_grams || 500;
        const baseSize = category.custom_weight_base_size || '1kg';
        menuText += `  📐 CUSTOM WEIGHTS: Any weight from ${formatWeight(minGrams)} (e.g., 750g, 1.5kg, 2kg)\n`;
        menuText += `  💰 PRICE: ${baseSize} price × weight (e.g., 2kg = 1kg price × 2)\n`;
        customWeightCategories.push(category.name);
      }
    }
  }

  menuText += `\n⚠️ ONLY use sizes listed above OR custom weights for categories that allow it.`;

  // Add custom weight pricing instructions if any category supports it
  if (customWeightCategories.length > 0) {
    menuText += `\n\n📐 CUSTOM WEIGHT CATEGORIES: ${customWeightCategories.join(', ')}`;
    menuText += `\nFor these categories, customers can order ANY weight (e.g., 750g, 1.25kg, 1.5kg, 2kg).`;
    menuText += `\nTo calculate price: use 1kg price × weight. Example: If 1kg=₹800, then 1.5kg=₹1200, 2kg=₹1600.`;
    menuText += `\nWhen customer asks "what's the price of 2kg [item]?", CALCULATE and respond with exact price.`;
    menuText += `\nFor standard sizes (500g, 1kg), use the menu price directly.`;
  }

  menuText += `\nWhen customer asks "show menu", use intent "show_menu" (system will send full details to customer).`;

  return menuText;
}

function getSystemPrompt(context: AIContext): string {
  const businessName = context.business?.name || 'our cafe';
  const minWait = context.business?.minimum_wait_minutes || 30;

  // ============================================
  // STATIC SECTION (cacheable - same for all requests per business)
  // Keep this at TOP for Gemini implicit caching
  // ============================================

  // Format menu with STRICT enforcement
  let menuSection = '';
  let itemNamesList = '';
  if (context.menuItems && context.menuItems.length > 0 && context.menuCategories) {
    menuSection = formatStrictMenuForAI(context.menuItems, context.menuCategories);
    itemNamesList = context.menuItems.map(item => `"${item.name}"`).join(', ');
  }

  // Format outlets for takeaway (static per business) with operating hours
  let outletsSection = '';
  if (context.outlets && context.outlets.length > 0) {
    outletsSection = `\nAVAILABLE OUTLETS FOR PICKUP:\n`;
    context.outlets.forEach((outlet, i) => {
      let outletLine = `${i + 1}. "${outlet.outlet_name}" - ${outlet.address}`;

      // Add operating hours if available
      if (outlet.opening_time && outlet.closing_time) {
        const openBuffer = outlet.opening_buffer_minutes || 0;
        const closeBuffer = outlet.closing_buffer_minutes || 0;

        // Calculate effective times with buffer
        const effectiveOpen = addMinutesToTime(outlet.opening_time, openBuffer);
        const effectiveClose = subtractMinutesFromTime(outlet.closing_time, closeBuffer);

        outletLine += ` | Hours: ${outlet.opening_time}-${outlet.closing_time}`;
        outletLine += ` (Delivery/Takeaway: ${effectiveOpen}-${effectiveClose})`;

        // Add open days if specified
        if (outlet.opening_days && outlet.opening_days.length > 0 && outlet.opening_days.length < 7) {
          const days = outlet.opening_days.map(d => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(', ');
          outletLine += ` | Open: ${days}`;
        }
      }
      outletsSection += outletLine + '\n';
    });

    // Add time validation instructions
    if (context.outlets.some(o => o.opening_time && o.closing_time)) {
      outletsSection += `\n⏰ TIME VALIDATION: Delivery/takeaway times must be within outlet operating hours (adjusted for buffer).`;
      outletsSection += `\nIf customer chooses a time outside operating hours, politely suggest another time within hours.`;
      if (context.business?.customer_support_phone) {
        outletsSection += `\nFor special requests outside hours, contact: ${context.business.customer_support_phone}`;
      }
    }
  }

  // Business-specific custom instructions (static per business)
  let customInstructions = '';
  if (context.business?.custom_ai_prompt) {
    customInstructions = `\n🏪 BUSINESS-SPECIFIC INSTRUCTIONS:\n${context.business.custom_ai_prompt}\n`;
  }

  // Customer support number (for when customers ask for help or issues arise)
  let customerSupportSection = '';
  if (context.business?.customer_support_phone) {
    customerSupportSection = `\n📞 CUSTOMER SUPPORT: ${context.business.customer_support_phone}\nIf customer asks for help, support, contact number, or has issues outside your capabilities, provide this number.\n`;
  }

  // Format amenities (party hall, catering, etc.)
  let amenitiesSection = '';
  if (context.amenities && context.amenities.length > 0) {
    amenitiesSection = `\n🏢 BUSINESS AMENITIES/SERVICES (NOT food items - these are services like party hall, catering):\n`;
    context.amenities.forEach(amenity => {
      amenitiesSection += `- "${amenity.name}" (slug: "${amenity.slug}")\n`;
    });
    amenitiesSection += `\nWhen customer asks about these services, use intent "amenity_inquiry" with amenity.amenity_slug.\n`;
    amenitiesSection += `If customer wants to BOOK/RESERVE an amenity, use intent "amenity_booking_request" (admin will be notified).\n`;
  }

  // Static prompt template
  const staticPrompt = `You are an AI ordering assistant for ${businessName}.
${customInstructions}${customerSupportSection}
${menuSection}
${outletsSection}${amenitiesSection}
⚠️ RULES: Only accept menu items. Match names EXACTLY. Never invent items/prices.
VALID ITEMS: [${itemNamesList}]

📋 JSON RESPONSE FORMAT:
{"reply": "1-2 sentences", "intent": "add_item|ask_question|modify_order|ready_for_checkout|confirm_order|cancel|show_menu|item_not_available|modify_custom_text|remove_custom_text|cancel_existing_order|check_order_status|conversation_ended|amenity_inquiry|amenity_booking_request|show_photos", "item": {"name": "exact menu name", "quantity": 1, "size_or_weight": "exact size", "notes": "per-item modifier"}, "items": [{"name": "item1", "quantity": 1, "notes": "modifier1"}, {"name": "item2", "quantity": 1, "notes": "modifier2"}], "fulfillment": {"fulfillment_type": "delivery|takeaway", "delivery_address": "", "delivery_time": ""}, "customText": "cake message", "order_id": "OKS-1", "amenity": {"amenity_slug": "party_hall"}, "menu_slug": "cakes-menu", "photoRequest": {"category": "category name"}}

📝 ITEM NOTES (per-item modifiers):
- When customer specifies different notes for items, use "items" array instead of "item"
- Example: "2 burgers - one less spicy, one extra cheese" → items: [{"name": "Burger", "quantity": 1, "notes": "less spicy"}, {"name": "Burger", "quantity": 1, "notes": "extra cheese"}]
- If all items have same modifier, use "item" with total quantity and notes
- Common modifiers: less sugar, no ice, extra spicy, less spicy, no onion, extra cheese, etc.

🚨 FLOW:
1. ADD ITEMS: Check menu → if size in message use "add_item" directly ("Rainbow 1kg" → add_item with size). Ask size only if not specified. Never checkout with empty cart.
2. CHECKOUT: "that's all"/"done" → "ready_for_checkout" (only if cart has items)
3. FULFILLMENT: delivery/takeaway → ask for address+time together. One type per order.
4. TIME REQUIRED: "innu"=today, "nale"=tomorrow. Reject past times. If time is within ${minWait}min from now, use "requires_intervention" (admin approval needed for urgent orders).
5. CONFIRM: After address+time collected → "confirm_order". One YES confirms order.

INTENTS:
- add_item: Add to cart (need name+quantity, size if applicable)
- ask_question: Need more info
- modify_order: Change qty (qty=0 removes)
- ready_for_checkout: Done adding → show summary
- confirm_order: Finalize after fulfillment info collected
- modify_custom_text: Change cake writing (include customText)
- remove_custom_text: Remove cake writing
- remove_addon: Remove addon (include addon.addon_name)
- custom_cake_inquiry: Customer asking about custom/personalized cake design
- cancel_existing_order/check_order_status: Include order_id (e.g., "OKS-1")
- show_menu: Show menu. If customer asks for specific menu (e.g., "cakes menu", "snacks"), include menu_slug matching the config slug
- show_photos: Customer wants to see photos/images/pics of items. Detect ANY photo request pattern:
  • Item photo: "X photo", "X pic", "X send photo", "send X photo", "picture of X", "X photo undo" → photoRequest.item_name
  • Category photo: "cake photos", "send picture of cake", "cakes pic" → photoRequest.category
  • Keywords: photo, pic, image, picture, send, show, ചിത്രം, ഫോട്ടോ, kaanikyoo
  Match item_name/category from menu. If unclear, use ask_question.
- amenity_inquiry: Customer asking about an amenity (party hall, etc.) - include amenity.amenity_slug
- amenity_booking_request: Customer wants to book/reserve an amenity - notify admin
- requires_intervention: Triggers admin support for urgent delivery, out of radius, or complex requests

🚑 INTERVENTIONS:
- Urgent Delivery (within ${minWait} minutes): Use "requires_intervention". Ask for date/time and reason.
- Out of Radius (far distance): Use "requires_intervention". Ask for location details.
- Special Events (large party): Use "amenity_inquiry" or "requires_intervention" if generic.

🎂 CUSTOM CAKE INQUIRIES:
When customer asks about custom cakes, personalized designs, "can you make this", "do you do custom cakes", "cake like this image":
- Use intent "custom_cake_inquiry"
- Ask them to: 1) Share an image OR describe what they want, 2) Specify weight (kg)
- Example: "Yes, we do custom cakes! Please share an image of the design you'd like OR describe it. Also, what weight/size do you need? (e.g., 1kg, 2kg)"

⚠️ CUSTOM CAKE PRICE RULES (IMPORTANT):
- For CUSTOM DESIGNED cakes (cakes with images/personalized designs), NEVER calculate prices yourself
- If customer asks about custom cake prices (rate/price/cost for custom design), say: "Our team will prepare a customized quote for your design."
- ONLY calculate prices for REGULAR MENU ITEMS with custom weights
- Custom cake pricing is ALWAYS confirmed by admin, not calculated by you

EXAMPLES:
Customer: "Rainbow 1kg" → {"reply": "Added Rainbow (1kg)! Anything else?", "intent": "add_item", "item": {"name": "Rainbow", "quantity": 1, "size_or_weight": "1kg"}}
Customer: "Delivery" → {"reply": "Share address and time (e.g., MG Road, tomorrow 5pm)", "intent": "ask_question", "fulfillment": {"fulfillment_type": "delivery"}}
Customer: "MG Road, nale 5pm" → {"reply": "Delivery to MG Road tomorrow 5pm. Confirm YES.", "intent": "collect_delivery_info", "fulfillment": {"fulfillment_type": "delivery", "delivery_address": "MG Road", "delivery_time": "tomorrow 5pm"}}
Customer: "Change text to Happy Birthday" → {"reply": "Updated!", "intent": "modify_custom_text", "customText": "Happy Birthday"}
Customer: "Cancel OKS-1" → {"reply": "Cancelling OKS-1.", "intent": "cancel_existing_order", "order_id": "OKS-1"}
Customer: "Do you have party hall?" → {"reply": "Yes! Let me share our party hall details.", "intent": "amenity_inquiry", "amenity": {"amenity_slug": "party_hall"}}
Customer: "I want to book the party hall" → {"reply": "I'll notify our team about your booking request!", "intent": "amenity_booking_request", "amenity": {"amenity_slug": "party_hall"}}
Customer: "Show me cake photos" → {"reply": "ഇതാ!", "intent": "show_photos", "photoRequest": {"category": "Cakes"}}
Customer: "Premium cake pics" → {"reply": "ഇതാ!", "intent": "show_photos", "photoRequest": {"category": "Premium Cakes"}}
Customer: "Blueberry Mousse photo" → {"reply": "ഇതാ!", "intent": "show_photos", "photoRequest": {"item_name": "Blueberry Mousse"}}
Customer: "Honey Almond send photo" → {"reply": "ഇതാ!", "intent": "show_photos", "photoRequest": {"item_name": "Honey Almond"}}
Customer: "send photo of Rainbow" → {"reply": "ഇതാ!", "intent": "show_photos", "photoRequest": {"item_name": "Rainbow"}}
Customer: "Could you please send picture of the cake" → {"reply": "ഇതാ!", "intent": "show_photos", "photoRequest": {"category": "Cakes"}}
Customer: "Blueberry Mousse photo undo" → {"reply": "ഇതാ!", "intent": "show_photos", "photoRequest": {"item_name": "Blueberry Mousse"}}
Customer: "Rainbow nte photo kanikku" → {"reply": "ഇതാ!", "intent": "show_photos", "photoRequest": {"item_name": "Rainbow"}}
Customer: "I want to see photos" → {"reply": "Which item/category?", "intent": "ask_question"}

STYLE: Friendly, short replies. Emojis sparingly. Prices as ₹150.

🗣️ LANGUAGE:
${context.customerLanguage === 'en'
      ? `- Respond in English. Customer has chosen English.
- Understand both Malayalam and English input.
- Common Malayalam words: oru=1, randu=2, mathi=enough, sheri=ok, venda=no, athe=yes, nale=tomorrow, innu=today.`
      : `- DEFAULT: Always respond in Malayalam (മലയാളം). All replies must be in Malayalam.
- If customer writes in English or asks "English please"/"respond in English", switch to English.
- Understand both Malayalam and English input, but RESPOND in Malayalam unless customer explicitly requests English.
- Common words: oru=1, randu=2, mathi=enough, sheri=ok, venda=no, athe=yes, nale=tomorrow, innu=today.`}
- Process all messages naturally without commenting on language or voice.`;

  // ============================================
  // DYNAMIC SECTION (changes per request - at BOTTOM)
  // This part won't be cached but static part above will be
  // ============================================

  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const currentTime = now.toTimeString().split(' ')[0].substring(0, 5);

  // Format current session items
  let currentItemsSection = '';
  let hasItemsInCart = false;
  if (context.currentSessionItems && context.currentSessionItems.length > 0) {
    hasItemsInCart = true;
    currentItemsSection = `🛒 ITEMS IN CART:\n${context.currentSessionItems.map((item, i) => `${i + 1}. ${item}`).join('\n')}`;
  } else {
    currentItemsSection = `🛒 CART IS EMPTY`;
  }

  // Fulfillment status
  let fulfillmentStatus = '📦 FULFILLMENT:';
  if (context.sessionHasFulfillmentType) {
    fulfillmentStatus += ' Type=CHOSEN';
  } else {
    fulfillmentStatus += ' Type=NOT_CHOSEN';
  }
  if (context.sessionHasDeliveryInfo) {
    fulfillmentStatus += ', Address=COLLECTED';
  }
  if (context.sessionHasPickupInfo) {
    fulfillmentStatus += ', Outlet=SELECTED';
  }

  // Ready for final confirmation?
  const readyForFinalConfirm = context.sessionHasFulfillmentType &&
    (context.sessionHasDeliveryInfo || context.sessionHasPickupInfo);
  if (readyForFinalConfirm) {
    fulfillmentStatus += ' 🎯 READY FOR CONFIRM - if customer says YES use "confirm_order"';
  }

  // Format available add-ons if any
  let addonsSection = '';
  if (context.availableAddons && context.availableAddons.length > 0) {
    addonsSection = `\nADD-ONS AVAILABLE: ${context.availableAddons.map(a => `"${a.name}" (${a.price !== null ? `₹${a.price}` : 'FREE'})`).join(', ')}`;
  }

  // Active order context for post-order inquiries
  let activeOrderSection = '';
  if (context.activeOrder) {
    const statusMap: Record<string, string> = {
      'confirmed': 'Order received',
      'processing': 'Being prepared',
      'out_for_delivery': 'Out for delivery',
    };
    const statusText = statusMap[context.activeOrder.status] || context.activeOrder.status;
    activeOrderSection = `
📋 CUSTOMER HAS ACTIVE ORDER:
- Order #${context.activeOrder.order_number} (Status: ${statusText})
- Total: ₹${context.activeOrder.total_amount}
- Type: ${context.activeOrder.fulfillment_type || 'N/A'}

IMPORTANT - ACTIVE ORDER HANDLING:
- If customer asks about their order status ("where's my order", "order status", "ente order", etc.): Use intent "check_order_status"
- If customer wants to place a NEW order (clear ordering intent like "I want to order..."): Use intent "add_item" as normal
- If customer's message is AMBIGUOUS (e.g., "hi", "hello", "can you help"): ASK them politely: "I see you have an order in progress (#${context.activeOrder.order_number}). Would you like to check on your order, or place a new order?"`;
  }

  // Dynamic context that changes per request
  const dynamicContext = `

--- CURRENT SESSION STATE ---
Date: ${today}, Time: ${currentTime}
${currentItemsSection}
${fulfillmentStatus}${addonsSection}${activeOrderSection}
${hasItemsInCart ? 'Customer: "That\'s all" → {"reply": "Here\'s your summary.", "intent": "ready_for_checkout"}' : 'Customer: "That\'s all" → {"reply": "Cart is empty!", "intent": "ask_question"}'}`;

  return staticPrompt + dynamicContext;
}

function buildPrompt(
  currentMessage: string,
  conversationHistory: Message[],
  context: AIContext
): string {
  const historyText = formatMessagesForAI(conversationHistory);
  let prompt = getSystemPrompt(context);

  if (historyText) {
    prompt += `\n\nConversation history:\n${historyText}`;
  }

  prompt += `\n\nCustomer: ${currentMessage}\n\nRespond with valid JSON only:`;

  return prompt;
}

function parseAIResponse(responseText: string): AIResponse {
  let jsonStr = responseText.trim();

  // Remove markdown code blocks
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.slice(7);
  }
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.slice(3);
  }
  if (jsonStr.endsWith('```')) {
    jsonStr = jsonStr.slice(0, -3);
  }

  jsonStr = jsonStr.trim();

  // ROBUST FIX: Extract only the first complete JSON object
  // Handles cases where AI returns duplicate JSON (e.g., raw JSON followed by markdown block)
  // Example: {"reply":"..."}\n```json\n{"reply":"..."}\n```
  const firstBrace = jsonStr.indexOf('{');
  if (firstBrace !== -1) {
    let braceCount = 0;
    let endIndex = -1;
    for (let i = firstBrace; i < jsonStr.length; i++) {
      if (jsonStr[i] === '{') braceCount++;
      else if (jsonStr[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          endIndex = i;
          break;
        }
      }
    }
    if (endIndex !== -1) {
      jsonStr = jsonStr.substring(firstBrace, endIndex + 1);
    }
  }

  try {
    const parsed = JSON.parse(jsonStr);

    if (!parsed.reply || !parsed.intent) {
      throw new Error('Missing required fields');
    }

    return {
      reply: parsed.reply,
      intent: parsed.intent,
      item: parsed.item,
      items: parsed.items,  // For multiple items with individual notes
      order_id: parsed.order_id,
      fulfillment: parsed.fulfillment,  // CRITICAL: Include fulfillment data!
      addon: parsed.addon,  // For remove_addon/add_addon intents
      customText: parsed.customText,  // For modify_custom_text intent
      amenity: parsed.amenity,  // For amenity_inquiry/amenity_booking_request intents
      photoRequest: parsed.photoRequest,  // For show_photos intent
    };
  } catch (error) {
    logger.warn('Failed to parse AI response as JSON', { error, responseText });

    return {
      reply: "I didn't quite understand that. Could you please rephrase? For example: 'I want a chocolate cake' or 'Show me the menu'.",
      intent: 'ask_question',
    };
  }
}

// Calculate Levenshtein distance for fuzzy matching
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

// Normalize item name - handle plurals, common variations
function normalizeItemName(name: string): string {
  let normalized = name.toLowerCase().trim();

  // Remove common plurals (s, es, ies -> y)
  if (normalized.endsWith('ies')) {
    normalized = normalized.slice(0, -3) + 'y';
  } else if (normalized.endsWith('es')) {
    normalized = normalized.slice(0, -2);
  } else if (normalized.endsWith('s') && !normalized.endsWith('ss')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

// Validate that item name exists in menu with fuzzy matching
export function validateItemAgainstMenu(
  itemName: string,
  menuItems: MenuItem[]
): MenuItem | null {
  if (!itemName || !menuItems || menuItems.length === 0) {
    return null;
  }

  const normalizedInput = normalizeItemName(itemName);

  // 1. Exact match first
  let found = menuItems.find(
    item => item.name.toLowerCase() === normalizedInput
  );

  if (found) return found;

  // 2. Normalized match (handles plurals like "burgers" -> "burger")
  found = menuItems.find(
    item => normalizeItemName(item.name) === normalizedInput
  );

  if (found) return found;

  // 3. Partial/substring match
  found = menuItems.find(
    item =>
      item.name.toLowerCase().includes(normalizedInput) ||
      normalizedInput.includes(item.name.toLowerCase())
  );

  if (found) return found;

  // 4. Fuzzy match using Levenshtein distance
  // Allow 2 character edits for short names, 3 for longer names
  const maxDistance = normalizedInput.length <= 5 ? 2 : 3;
  let bestMatch: MenuItem | null = null;
  let bestDistance = Infinity;

  for (const item of menuItems) {
    const itemNormalized = normalizeItemName(item.name);
    const distance = levenshteinDistance(normalizedInput, itemNormalized);

    if (distance < bestDistance && distance <= maxDistance) {
      bestDistance = distance;
      bestMatch = item;
    }
  }

  return bestMatch;
}

// Validate size exists for item OR is valid custom weight
export function validateSizeForItem(
  size: string,
  menuItem: MenuItem,
  category?: MenuCategory | null
): boolean {
  if (!size) {
    return true; // No size to validate
  }

  // Check for exact size match first (works for all categories)
  if (menuItem.sizes && menuItem.sizes.length > 0) {
    const normalizedSize = size.toLowerCase().trim();
    const exactMatch = menuItem.sizes.some(
      s => s.name.toLowerCase() === normalizedSize
    );
    if (exactMatch) {
      return true;
    }
  }

  // Check if custom weight is allowed for this category
  if (category?.allows_custom_weight) {
    const { parseWeight, validateMinWeight } = require('../utils/weightUtils');
    const parsed = parseWeight(size);
    if (parsed.isValid) {
      const minGrams = category.custom_weight_min_grams || 500;
      const validation = validateMinWeight(parsed.grams, minGrams);
      return validation.isValid;
    }
  }

  // If no sizes array and no custom weight, allow any size
  if (!menuItem.sizes || menuItem.sizes.length === 0) {
    return true;
  }

  return false;
}

// Extract size from message if present (e.g., "Rainbow 1kg" -> { item: "Rainbow", size: "1kg" })
export function extractSizeFromMessage(
  message: string,
  menuItem: MenuItem
): { size: string | null; cleanedMessage: string } {
  if (!menuItem.sizes || menuItem.sizes.length === 0) {
    return { size: null, cleanedMessage: message };
  }

  const normalizedMessage = message.toLowerCase().trim();

  // Check each size for the item
  for (const sizeOption of menuItem.sizes) {
    const sizeName = sizeOption.name.toLowerCase();

    // Check for exact size match in message
    // Patterns: "1kg", "1 kg", "500g", "500 g", "small", "medium", "large"
    const sizePatterns = [
      new RegExp(`\\b${sizeName}\\b`, 'i'),
      new RegExp(`\\b${sizeName.replace(/(\d+)/, '$1\\s*')}\\b`, 'i'), // Allow space in "1 kg"
    ];

    for (const pattern of sizePatterns) {
      if (pattern.test(normalizedMessage)) {
        // Remove size from message to get clean item name
        const cleanedMessage = message.replace(pattern, '').trim();
        return { size: sizeOption.name, cleanedMessage };
      }
    }
  }

  return { size: null, cleanedMessage: message };
}

/**
 * Classify if a user's response to a custom text prompt is valid text or a question
 * Uses AI to handle any language (English, Malayalam, Manglish) and phrasing
 */
export interface CustomTextClassification {
  isValidText: boolean;      // True if user provided actual text to write
  cleanedText: string | null; // Extracted text (stripped of "yes", "ok" prefixes)
  isQuestion: boolean;       // True if user is asking a question
  isAffirmation: boolean;    // True if user said "yes/ok" meaning they want to provide text (but haven't yet)
}

export async function classifyCustomTextResponse(
  userResponse: string,
  customTextPrompt: string
): Promise<CustomTextClassification> {
  const classificationPrompt = `You are classifying a customer's response to a prompt asking for text to write on a cake/item.

PROMPT ASKED TO CUSTOMER: "${customTextPrompt}"
CUSTOMER'S RESPONSE: "${userResponse}"

Classify the response:
1. VALID_TEXT: Customer provided text to write (even with "yes"/"ok" prefix, or in Malayalam/other languages)
2. QUESTION: Customer is asking a question (price, availability, "how much", "rate ethra", etc.)
3. AFFIRMATION: Customer said just "yes"/"yeah"/"ok"/"sure"/"athe"/"sheri" alone - meaning they WANT to provide text but haven't given it yet
4. SKIP: Customer wants to skip (no, nothing, skip, none, venda, etc.)

If VALID_TEXT: Extract ONLY the text to write on cake (remove conversational prefixes like "yes", "ok", "sure", "athe", "sheri")
If QUESTION, AFFIRMATION, or SKIP: cleanedText should be null

Respond with JSON only:
{"isValidText": boolean, "cleanedText": "string or null", "isQuestion": boolean, "isAffirmation": boolean}

Examples:
- "Yes, Happy Birthday" → {"isValidText": true, "cleanedText": "Happy Birthday", "isQuestion": false, "isAffirmation": false}
- "How much" → {"isValidText": false, "cleanedText": null, "isQuestion": true, "isAffirmation": false}
- "Janmadhinashamsakal" → {"isValidText": true, "cleanedText": "Janmadhinashamsakal", "isQuestion": false, "isAffirmation": false}
- "What's the rate?" → {"isValidText": false, "cleanedText": null, "isQuestion": true, "isAffirmation": false}
- "rate ethra" → {"isValidText": false, "cleanedText": null, "isQuestion": true, "isAffirmation": false}
- "no thanks" → {"isValidText": false, "cleanedText": null, "isQuestion": false, "isAffirmation": false}
- "ok write Happy Anniversary" → {"isValidText": true, "cleanedText": "Happy Anniversary", "isQuestion": false, "isAffirmation": false}
- "Best Wishes to Mom" → {"isValidText": true, "cleanedText": "Best Wishes to Mom", "isQuestion": false, "isAffirmation": false}
- "athe, Congrats" → {"isValidText": true, "cleanedText": "Congrats", "isQuestion": false, "isAffirmation": false}
- "Yes" → {"isValidText": false, "cleanedText": null, "isQuestion": false, "isAffirmation": true}
- "yeah" → {"isValidText": false, "cleanedText": null, "isQuestion": false, "isAffirmation": true}
- "ok" → {"isValidText": false, "cleanedText": null, "isQuestion": false, "isAffirmation": true}
- "sure" → {"isValidText": false, "cleanedText": null, "isQuestion": false, "isAffirmation": true}
- "athe" → {"isValidText": false, "cleanedText": null, "isQuestion": false, "isAffirmation": true}
- "sheri" → {"isValidText": false, "cleanedText": null, "isQuestion": false, "isAffirmation": true}`;

  try {
    const aiClient = getAIClient();
    const responseText = await aiClient.processMessage(classificationPrompt);

    if (!responseText) {
      logger.warn('Empty response from AI for custom text classification');
      // Default: assume it's valid text, save as-is
      return { isValidText: true, cleanedText: userResponse, isQuestion: false, isAffirmation: false };
    }

    // Parse JSON response
    let jsonStr = responseText.trim();
    if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
    if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
    jsonStr = jsonStr.trim();

    const parsed = JSON.parse(jsonStr);

    logger.info(`Custom text classification: "${userResponse}" → valid=${parsed.isValidText}, question=${parsed.isQuestion}, affirmation=${parsed.isAffirmation}, cleaned="${parsed.cleanedText}"`);

    return {
      isValidText: parsed.isValidText === true,
      cleanedText: parsed.cleanedText || null,
      isQuestion: parsed.isQuestion === true,
      isAffirmation: parsed.isAffirmation === true,
    };
  } catch (error) {
    logger.error('Failed to classify custom text response', { error, userResponse });
    // Fallback: check if it's just an affirmation word
    const affirmationOnly = /^(yes|yeah|yep|yup|ok|okay|sure|athe|ath|sheri)$/i.test(userResponse.trim());
    if (affirmationOnly) {
      return { isValidText: false, cleanedText: null, isQuestion: false, isAffirmation: true };
    }
    // Otherwise assume it's valid text, do basic cleanup
    let cleaned = userResponse;
    cleaned = cleaned.replace(/^(yes|yeah|yep|yup|ok|okay|sure|athe|ath|sheri)[,.\s]+/i, '').trim();
    return { isValidText: true, cleanedText: cleaned, isQuestion: false, isAffirmation: false };
  }
}

export async function processMessageWithAI(
  currentMessage: string,
  conversationHistory: Message[],
  _sessionContext: Session,
  context: AIContext = {}
): Promise<AIResponse> {
  const prompt = buildPrompt(currentMessage, conversationHistory, context);

  try {
    const aiClient = getAIClient();
    const result = await aiClient.processMessageWithUsage(prompt);

    // Track AI usage if we have a business ID
    if (context.business?.id) {
      trackAIUsage({
        businessId: context.business.id,
        provider: aiClient.getProvider() as AIProvider,
        tokensInput: result.usage.inputTokens,
        tokensOutput: result.usage.outputTokens,
        latencyMs: result.usage.latencyMs,
        success: !!result.text,
        errorMessage: result.text ? undefined : 'Empty AI response',
      }).catch(err => logger.warn('Failed to track AI usage', err));
    }

    const responseText = result.text;

    if (!responseText) {
      logger.error('Empty response from AI provider');
      throw new Error('Empty AI response');
    }

    logger.debug('AI raw response', responseText);

    let aiResponse = parseAIResponse(responseText);

    // VALIDATION: If AI tries to add an item, verify it exists in menu
    if (aiResponse.intent === 'add_item' && aiResponse.item?.name && context.menuItems) {
      const validItem = validateItemAgainstMenu(aiResponse.item.name, context.menuItems);

      if (!validItem) {
        // Item doesn't exist - override AI response
        logger.warn(`AI tried to add non-menu item: ${aiResponse.item.name}`);
        const availableItems = context.menuItems.map(i => i.name).slice(0, 5).join(', ');
        aiResponse = {
          reply: `Sorry, "${aiResponse.item.name}" is not on our menu. We have: ${availableItems}. What would you like?`,
          intent: 'item_not_available' as any,
        };
      } else {
        // Correct the item name to exact menu name
        aiResponse.item.name = validItem.name;

        // If AI didn't extract size but item requires it, try extracting from original message
        if (!aiResponse.item.size_or_weight && validItem.sizes && validItem.sizes.length > 0) {
          const { size } = extractSizeFromMessage(currentMessage, validItem);
          if (size) {
            logger.info(`Extracted size from message: ${size}`);
            aiResponse.item.size_or_weight = size;
          }
        }

        // Validate size if provided (pass category for custom weight check)
        const itemCategory = context.menuCategories?.find(c => c.id === validItem.category_id);
        if (aiResponse.item.size_or_weight && !validateSizeForItem(aiResponse.item.size_or_weight, validItem, itemCategory)) {
          let availableSizes = validItem.sizes?.map(s => s.name).join(', ') || 'standard';
          // Add custom weight info if applicable
          if (itemCategory?.allows_custom_weight) {
            const minGrams = itemCategory.custom_weight_min_grams || 500;
            availableSizes += ` (or custom weight from ${formatWeight(minGrams)})`;
          }
          aiResponse = {
            reply: `Sorry, we don't have that size for ${validItem.name}. Available: ${availableSizes}. Which would you like?`,
            intent: 'ask_question',
            item: { ...aiResponse.item, size_or_weight: undefined },
          };
        }
      }
    }

    // FALLBACK: If AI is asking for size but size was in the original message, convert to add_item
    if (aiResponse.intent === 'ask_question' && aiResponse.item?.name && context.menuItems) {
      const validItem = validateItemAgainstMenu(aiResponse.item.name, context.menuItems);
      if (validItem && validItem.sizes && validItem.sizes.length > 0) {
        const { size } = extractSizeFromMessage(currentMessage, validItem);
        if (size) {
          logger.info(`AI asked for size but it was in message. Converting to add_item with size: ${size}`);
          aiResponse = {
            reply: `Added ${validItem.name} (${size}) to your cart! Anything else?`,
            intent: 'add_item',
            item: {
              name: validItem.name,
              quantity: aiResponse.item.quantity || 1,
              size_or_weight: size,
            },
          };
        }
      }
    }

    logger.info(`AI Intent: ${aiResponse.intent}`);
    return aiResponse;

  } catch (error) {
    logger.error('Error processing message with AI', { error });

    // Build professional error message with customer support if available
    let errorReply = "We're experiencing a temporary issue processing your request. Please try again in a moment.";

    if (context.business?.customer_support_phone) {
      errorReply += `\n\n📞 Need immediate assistance? Contact us: ${context.business.customer_support_phone}`;
    }

    errorReply += "\n\n_Tip: You can continue ordering by telling us what you'd like._";

    return {
      reply: errorReply,
      intent: 'ask_question',
    };
  }
}

// ============================================
// IMAGE CLASSIFICATION (Gemini Vision)
// ============================================

export type ImageClassification =
  | 'cake_design'      // A cake photo/design for customization
  | 'menu_screenshot'  // Screenshot of menu/item
  | 'food_photo'       // General food photo (not cake)
  | 'other';           // Unrelated image

export interface ImageClassificationResult {
  classification: ImageClassification;
  confidence: number;        // 0.0 - 1.0
  isCake: boolean;           // Quick check: is this a cake?
  detectedItemName?: string; // If menu_screenshot, what item is it?
  reasoning: string;         // Why this classification
}

/**
 * Classify an image using Gemini Vision
 * Determines if image is: cake_design, menu_screenshot, food_photo, or other
 */
export async function classifyImageWithGemini(
  imageBase64: string,
  mimeType: string,
  menuItemNames?: string[] // Optional: menu items for matching screenshots
): Promise<ImageClassificationResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.error('GEMINI_API_KEY not configured for image classification');
    return {
      classification: 'other',
      confidence: 0,
      isCake: false,
      reasoning: 'API key not configured',
    };
  }

  const menuContext = menuItemNames && menuItemNames.length > 0
    ? `\n\nMENU ITEMS (for matching screenshots): ${menuItemNames.join(', ')}`
    : '';

  const prompt = `You are an image classifier for a bakery/cafe ordering system. Analyze this image and classify it.

CLASSIFICATION TYPES:
1. "cake_design" - A photo of a cake, cake design, or reference image for custom cake order
   - Birthday cakes, wedding cakes, themed cakes, decorated cakes
   - Cake design reference photos from internet/Pinterest
   - Photos showing cake decoration, fondant work, etc.

2. "menu_screenshot" - A screenshot of a menu, price list, or specific menu item
   - Screenshots from WhatsApp/website showing menu items
   - Photos of menu boards or price lists
   - If you can identify a specific item name, include it

3. "food_photo" - Other food photos (not cakes)
   - Pastries, cookies, bread, snacks, beverages
   - Food that is NOT a cake

4. "other" - Non-food related images
   - Receipts, documents, random photos, selfies, etc.
${menuContext}

IMPORTANT RULES:
- If the image shows ANY type of cake (even partial), classify as "cake_design"
- Be generous with "cake_design" - if it looks like a cake reference, it probably is
- For menu screenshots, try to identify the item name if visible

Respond with JSON only (no markdown):
{"classification": "cake_design|menu_screenshot|food_photo|other", "confidence": 0.0-1.0, "isCake": true/false, "detectedItemName": "item name if menu screenshot", "reasoning": "brief explanation"}`;

  try {
    const { GEMINI_MODEL_NAME } = await import('../config/constants');

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_NAME}:generateContent?key=${apiKey}`,
      {
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: mimeType,
                  data: imageBase64,
                },
              },
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1, // Low temperature for consistent classification
          maxOutputTokens: 500,
        },
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      }
    );

    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      logger.warn('Empty response from Gemini for image classification');
      return {
        classification: 'other',
        confidence: 0.5,
        isCake: false,
        reasoning: 'Empty API response',
      };
    }

    // Parse JSON response
    let jsonStr = text.trim();
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();

    // Extract first JSON object
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
    }

    const parsed = JSON.parse(jsonStr);

    const result: ImageClassificationResult = {
      classification: parsed.classification || 'other',
      confidence: parsed.confidence || 0.5,
      isCake: parsed.isCake === true || parsed.classification === 'cake_design',
      detectedItemName: parsed.detectedItemName,
      reasoning: parsed.reasoning || 'No reasoning provided',
    };

    logger.info(`Image classified: ${result.classification} (${Math.round(result.confidence * 100)}% confidence) - ${result.reasoning}`);
    return result;

  } catch (error: any) {
    logger.error('Failed to classify image with Gemini', error);

    // Fallback: assume it might be a cake (safer for bakery context)
    return {
      classification: 'other',
      confidence: 0.3,
      isCake: false,
      reasoning: `Classification failed: ${error.message}`,
    };
  }
}
