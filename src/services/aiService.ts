import axios from 'axios';
import { Message, AIResponse, Session, Business, MenuItem, MenuCategory, BusinessOutlet, MenuAddon } from '../types';
import { formatMessagesForAI } from './messageService';
import { logger } from '../utils/logger';
import { getAIClient } from './aiClient';

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
}

// Format menu for AI - includes item names AND sizes (to prevent hallucination)
function formatStrictMenuForAI(items: MenuItem[], categories: MenuCategory[]): string {
  if (items.length === 0) {
    return 'MENU: No items available.';
  }

  // Group items by category with size info
  const categoryMap = new Map<string, string[]>();

  for (const item of items) {
    if (item.category_id) {
      const existing = categoryMap.get(item.category_id) || [];

      // Format item with sizes if available
      let itemText = item.name;
      if (item.sizes && item.sizes.length > 0) {
        const sizeNames = item.sizes.map(s => s.name).join(', ');
        itemText += ` [sizes: ${sizeNames}]`;
      }

      existing.push(itemText);
      categoryMap.set(item.category_id, existing);
    }
  }

  let menuText = `AVAILABLE MENU (with available sizes):\n\n`;

  // Format each category with items and sizes
  for (const category of categories) {
    const categoryItems = categoryMap.get(category.id);
    if (categoryItems && categoryItems.length > 0) {
      menuText += `${category.name}:\n`;
      categoryItems.forEach(item => {
        menuText += `  - ${item}\n`;
      });
    }
  }

  menuText += `\n⚠️ ONLY use sizes listed above. NEVER invent sizes like "Regular", "Large", "Extra Large" unless they are in the list.`;
  menuText += `\nWhen customer asks "show menu", use intent "show_menu" (system will send full details to customer).`;

  return menuText;
}

function getSystemPrompt(context: AIContext): string {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const currentTime = now.toTimeString().split(' ')[0].substring(0, 5); // HH:MM format
  const businessName = context.business?.name || 'our cafe';

  // Format menu with STRICT enforcement
  let menuSection = '';
  let itemNamesList = '';
  if (context.menuItems && context.menuItems.length > 0 && context.menuCategories) {
    menuSection = formatStrictMenuForAI(context.menuItems, context.menuCategories);
    itemNamesList = context.menuItems.map(item => `"${item.name}"`).join(', ');
  }

  // Format current session items - CRITICAL for tracking
  let currentItemsSection = '';
  let hasItemsInCart = false;
  if (context.currentSessionItems && context.currentSessionItems.length > 0) {
    hasItemsInCart = true;
    currentItemsSection = `\n🛒 ITEMS ALREADY IN CART:\n${context.currentSessionItems.map((item, i) => `${i + 1}. ${item}`).join('\n')}`;
  } else {
    currentItemsSection = `\n🛒 CART IS EMPTY - No items added yet`;
  }

  // Format outlets for takeaway
  let outletsSection = '';
  if (context.outlets && context.outlets.length > 0) {
    outletsSection = `\n\nAVAILABLE OUTLETS FOR PICKUP:\n`;
    context.outlets.forEach((outlet, i) => {
      outletsSection += `${i + 1}. "${outlet.outlet_name}" - ${outlet.address}\n`;
    });
  }

  // Fulfillment status - make it very clear to AI
  let fulfillmentStatus = '\n\n📦 FULFILLMENT STATUS:';
  if (context.sessionHasFulfillmentType) {
    fulfillmentStatus += '\n✅ Fulfillment type: CHOSEN';
  } else {
    fulfillmentStatus += '\n❌ Fulfillment type: NOT YET CHOSEN';
  }
  if (context.sessionHasDeliveryInfo) {
    fulfillmentStatus += '\n✅ Delivery address: COLLECTED';
  }
  if (context.sessionHasPickupInfo) {
    fulfillmentStatus += '\n✅ Pickup outlet: SELECTED';
  }

  // Determine if ready for final confirmation
  const readyForFinalConfirm = context.sessionHasFulfillmentType &&
    (context.sessionHasDeliveryInfo || context.sessionHasPickupInfo);
  if (readyForFinalConfirm) {
    fulfillmentStatus += '\n\n🎯 READY FOR FINAL CONFIRMATION - when customer says YES, use "confirm_order"';
  }

  // Format available add-ons if any
  let addonsSection = '';
  if (context.availableAddons && context.availableAddons.length > 0) {
    addonsSection = `\n\nAVAILABLE ADD-ONS FOR LAST ADDED ITEM:\n`;
    context.availableAddons.forEach((addon, i) => {
      addonsSection += `${i + 1}. "${addon.name}" - ${addon.price !== null ? `₹${addon.price}` : 'FREE'}`;
      if (addon.description) {
        addonsSection += ` - ${addon.description}`;
      }
      addonsSection += '\n';
    });
  }

  // Business-specific custom instructions
  let customInstructions = '';
  if (context.business?.custom_ai_prompt) {
    customInstructions = `\n\n🏪 BUSINESS-SPECIFIC INSTRUCTIONS (MUST FOLLOW):\n${context.business.custom_ai_prompt}\n`;
  }

  return `You are an AI ordering assistant for ${businessName}.
Current date: ${today}, Current time: ${currentTime}
${customInstructions}
${menuSection}
${currentItemsSection}${outletsSection}${fulfillmentStatus}${addonsSection}

⚠️ STRICT RULES ⚠️
1. ONLY accept orders for items in the menu above
2. If item NOT in menu: use "item_not_available" intent, suggest alternatives
3. Item names MUST match EXACTLY from menu
4. NEVER hallucinate or invent items/prices

VALID ITEMS: [${itemNamesList}]

📋 RESPONSE FORMAT (JSON only):
{
  "reply": "your message (1-2 sentences)",
  "intent": "add_item | ask_question | modify_order | ready_for_checkout | confirm_order | cancel | show_menu | item_not_available | conversation_ended",
  "item": {
    "name": "EXACT name from menu",
    "quantity": 1,
    "size_or_weight": "EXACT size from menu",
    "delivery_date": "YYYY-MM-DD",
    "notes": "optional notes"
  },
  "fulfillment": {
    "fulfillment_type": "delivery | takeaway",
    "delivery_address": "address text",
    "delivery_time": "time text",
    "pickup_outlet_id": "outlet id",
    "pickup_time": "time text"
  }
}

🚨 CRITICAL ORDERING FLOW 🚨

STEP 1 - ADD ITEMS (MANDATORY):
- When customer asks for an item → CHECK if it's in the menu
- ⚠️ IMPORTANT: Check if customer ALREADY specified size in their message!
  Examples: "Rainbow 1kg" = item "Rainbow" + size "1kg" → use "add_item" directly!
  "2 medium burgers" = item "Burger" + size "Medium" + quantity 2 → use "add_item" directly!
- ONLY use "ask_question" for size if customer did NOT specify it
- If in menu AND all details provided → use "add_item" with complete item object
- ⚠️ NEVER skip to fulfillment if cart is empty!

STEP 2 - CHECKOUT:
- When customer says "that's all", "done", "no more" → use "ready_for_checkout"
- System will show order summary and ask for delivery/takeaway
- ⚠️ ONLY proceed to checkout if CART HAS ITEMS!

STEP 3 - FULFILLMENT (IMPORTANT - COLLECT BOTH ADDRESS AND TIME):
- Customer chooses "delivery" or "takeaway" → use "ask_question" with fulfillment data
- ONE order = ONE fulfillment type only (no mixing)
- For delivery: ASK for BOTH address AND time in ONE question
- For takeaway: show outlet list, collect selection AND time

STEP 4 - TIME RULES (MANDATORY FOR ORDER):
- ⚠️ TIME IS REQUIRED - orders CANNOT be confirmed without date/time
- Ask for time along with address: "Please share your delivery address and preferred time"
- Accept formats: "MG Road, tomorrow 5pm", "tomorrow", "nale 4pm", "innu evening", "today 6:30pm"
- Malayalam: "innu" = today, "nale" = tomorrow
- If customer gives address WITHOUT time, ask: "What time would you like delivery?"
- Minimum wait ${context.business?.minimum_wait_minutes || 30} minutes
- REJECT past dates/times - say "Please choose a future time"

STEP 5 - FINAL CONFIRM:
- After delivery address OR pickup outlet is collected → use "confirm_order"
- When customer says "yes" after providing delivery/pickup info → use "confirm_order"
- System will create the order and show confirmation

⚠️ ONLY ONE "YES" NEEDED:
- After customer provides delivery address or selects pickup outlet, confirm the order
- Don't ask for separate item confirmation - go straight to fulfillment after summary

INTENT GUIDE:
- "add_item": Customer wants item AND you have name + size + quantity → ADD TO CART
- "ask_question": Need more info (which size? what quantity? delivery/takeaway? address?)
- "modify_order": Change quantity/remove item (set quantity=0 to remove)
- "ready_for_checkout": Customer done adding items → show summary + ask delivery/takeaway
- "confirm_order": Customer provided delivery address OR pickup outlet → FINALIZE ORDER
- "show_menu": Customer asks what's available
- "item_not_available": Item not in menu
- "cancel": Customer wants to stop CURRENT ordering session (no order placed yet)
- "cancel_existing_order": Customer wants to CANCEL a CONFIRMED order → extract order_id (e.g., "OKS-1")
- "check_order_status": Customer asks about order STATUS → extract order_id (e.g., "OKS-1")
- "conversation_ended": Farewell after order complete

ORDER MANAGEMENT:
- When customer says "cancel order OKS-1" or "cancel my order" → use "cancel_existing_order" with order_id
- When customer says "status of OKS-1" or "where is my order" → use "check_order_status" with order_id
- Extract order_id from messages like "OKS-1", "oks-2", "order OKS-3", etc.

EXAMPLES:

Customer: "I want a burger"
${context.menuItems?.find(i => i.name.toLowerCase().includes('burger'))?.sizes ?
`{"reply": "Great choice! What size - small, medium, or large?", "intent": "ask_question", "item": {"name": "Burger"}}` :
`{"reply": "Added 1 Burger to your cart! Anything else?", "intent": "add_item", "item": {"name": "Burger", "quantity": 1}}`}

Customer: "Medium burger" or "burger medium" (size already specified!)
{"reply": "Added Burger (Medium) to your cart! Anything else?", "intent": "add_item", "item": {"name": "Burger", "quantity": 1, "size_or_weight": "Medium"}}

Customer: "Rainbow 1kg" (item + size in one message!)
{"reply": "Added Rainbow (1kg) to your cart! Anything else?", "intent": "add_item", "item": {"name": "Rainbow", "quantity": 1, "size_or_weight": "1kg"}}

Customer: "That's all"
${hasItemsInCart ?
`{"reply": "Let me show you your order summary.", "intent": "ready_for_checkout"}` :
`{"reply": "Your cart is empty! What would you like to order?", "intent": "ask_question"}`}

Customer: "Delivery" (after seeing summary)
{"reply": "Please share your delivery address and preferred time (e.g., 'MG Road, tomorrow 5pm').", "intent": "ask_question", "fulfillment": {"fulfillment_type": "delivery"}}

Customer: "MG Road, tomorrow 5pm" or "MG Road nale 5pm" (address with time)
{"reply": "Delivery to MG Road, tomorrow at 5pm. Please confirm YES.", "intent": "collect_delivery_info", "fulfillment": {"fulfillment_type": "delivery", "delivery_address": "MG Road", "delivery_time": "tomorrow 5pm"}}

Customer: "MG Road" (address only - WITHOUT time)
{"reply": "Got it, MG Road. What time would you like delivery? (e.g., 'today 6pm', 'nale 3pm')", "intent": "ask_question", "fulfillment": {"fulfillment_type": "delivery", "delivery_address": "MG Road"}}

Customer: "today 6pm" or "innu 6pm" (time after giving address)
{"reply": "Delivery to MG Road at 6pm today. Please confirm YES.", "intent": "collect_delivery_info", "fulfillment": {"fulfillment_type": "delivery", "delivery_time": "today 6pm"}}

Customer: "Takeaway" (after seeing summary)
{"reply": "Please select your pickup location and preferred time.", "intent": "ask_question", "fulfillment": {"fulfillment_type": "takeaway"}}

Customer: "Yesterday 5pm" (past time)
{"reply": "Sorry, that time has passed. Please choose a future time (e.g., today 6pm, tomorrow 10am).", "intent": "ask_question"}

Customer: "Cancel order OKS-1" or "I want to cancel OKS-1"
{"reply": "I'll cancel order OKS-1 for you.", "intent": "cancel_existing_order", "order_id": "OKS-1"}

Customer: "What's the status of OKS-2?" or "Where is my order OKS-2?"
{"reply": "Let me check the status of OKS-2.", "intent": "check_order_status", "order_id": "OKS-2"}

Customer: "Cancel my order" (without order number)
{"reply": "Please provide your order number to cancel (e.g., OKS-1).", "intent": "cancel_existing_order"}

Customer: "Check my order status" (without order number)
{"reply": "Please provide your order number to check its status (e.g., OKS-1).", "intent": "check_order_status"}

REMEMBER:
- CART MUST have items before checkout/fulfillment
- After customer provides delivery address AND time → use "collect_delivery_info" (system shows invoice)
- After customer confirms with YES → order is created
- ONE fulfillment type per order (no mixing delivery+takeaway)
- ⚠️ TIME IS MANDATORY - always ask for time if not provided with address
- Malayalam time words: "innu" = today, "nale" = tomorrow
- Reject past dates/times if provided
- Keep replies short (1-2 sentences)

🗣️ COMMUNICATION STYLE:
- Be warm, friendly, and conversational - like a helpful local shop assistant
- Use emojis naturally and sparingly: 🛒 cart, ✅ confirmed, 🚚 delivery, 📍 location, 💰 price, ☕ coffee, 🍰 cake
- Format prices clearly: ₹150 (not Rs.150 or INR 150)
- Use bold for emphasis in summaries: *Total: ₹500*
- Keep tone friendly: "Great choice!", "Coming right up!", "Anything else?"
- Don't overuse emojis - 1-2 per message is enough

🌴 MANGLISH/KERALA SUPPORT:
- Customer may use Manglish (Malayalam + English mixed)
- Common words you'll see (already normalized by system):
  • Numbers: "oru"=one, "randu"=two, "moonu"=three, "nalu"=four, "anju"=five
  • Words: "veno"=want, "venam"=need, "mathi"=enough, "sheri"=okay, "illa"=no
  • Time: "innu"=today, "nale"=tomorrow, "raavile"=morning, "vaikittu"=evening
  • Food: "chaya"=tea, "kaapi"=coffee, "kattan"=black tea
- Respond naturally in English - system handles the translation
- If customer seems confused, be patient and helpful

RESPONSE EXAMPLES:
Customer: "oru coffee"
AI: {"reply": "Added 1 Coffee to your cart! ☕ Anything else?", "intent": "add_item", "item": {"name": "Coffee", "quantity": 1}}

Customer: "randu burger venam"
AI: {"reply": "Added 2 Burgers to your cart! 🍔 Anything else?", "intent": "add_item", "item": {"name": "Burger", "quantity": 2}}

Customer: "mathi, checkout"
AI: {"reply": "Let me show your order summary.", "intent": "ready_for_checkout"}

Customer: "sheriya, delivery"
AI: {"reply": "Please share your delivery address and preferred time.", "intent": "ask_question", "fulfillment": {"fulfillment_type": "delivery"}}`;
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

  try {
    const parsed = JSON.parse(jsonStr);

    if (!parsed.reply || !parsed.intent) {
      throw new Error('Missing required fields');
    }

    return {
      reply: parsed.reply,
      intent: parsed.intent,
      item: parsed.item,
      order_id: parsed.order_id,
      fulfillment: parsed.fulfillment,  // CRITICAL: Include fulfillment data!
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

// Validate size exists for item
export function validateSizeForItem(
  size: string,
  menuItem: MenuItem
): boolean {
  if (!size || !menuItem.sizes || menuItem.sizes.length === 0) {
    return true; // No size validation needed
  }

  const normalizedSize = size.toLowerCase().trim();
  return menuItem.sizes.some(
    s => s.name.toLowerCase() === normalizedSize
  );
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

export async function processMessageWithAI(
  currentMessage: string,
  conversationHistory: Message[],
  _sessionContext: Session,
  context: AIContext = {}
): Promise<AIResponse> {
  const prompt = buildPrompt(currentMessage, conversationHistory, context);

  try {
    const aiClient = getAIClient();
    const responseText = await aiClient.processMessage(prompt);

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

        // Validate size if provided
        if (aiResponse.item.size_or_weight && !validateSizeForItem(aiResponse.item.size_or_weight, validItem)) {
          const availableSizes = validItem.sizes?.map(s => s.name).join(', ') || 'standard';
          aiResponse = {
            reply: `Sorry, we don't have that size for ${validItem.name}. Available sizes: ${availableSizes}. Which would you like?`,
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
