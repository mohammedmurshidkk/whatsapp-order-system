import axios from 'axios';
import { Message, AIResponse, Session, Business, MenuItem, MenuCategory } from '../types';
import { GEMINI_MODEL } from '../config/constants';
import { formatMessagesForAI } from './messageService';
import { logger } from '../utils/logger';

const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export interface AIContext {
  business?: Business;
  menuItems?: MenuItem[];
  menuCategories?: MenuCategory[];
  currentSessionItems?: string[];
}

// Format menu for AI with STRICT item names list
function formatStrictMenuForAI(items: MenuItem[], categories: MenuCategory[]): string {
  if (items.length === 0) {
    return 'MENU: No items available.';
  }

  // Create a list of EXACT item names
  const itemNames = items.map(item => item.name);

  let menuText = `AVAILABLE MENU ITEMS (ONLY THESE CAN BE ORDERED):\n`;
  menuText += `EXACT ITEM NAMES: [${itemNames.map(n => `"${n}"`).join(', ')}]\n\n`;

  // Group items by category
  const categoryMap = new Map<string, MenuItem[]>();

  for (const item of items) {
    if (item.category_id) {
      const existing = categoryMap.get(item.category_id) || [];
      existing.push(item);
      categoryMap.set(item.category_id, existing);
    }
  }

  // Format each category
  for (const category of categories) {
    const categoryItems = categoryMap.get(category.id);
    if (categoryItems && categoryItems.length > 0) {
      menuText += `${category.name.toUpperCase()}:\n`;
      for (const item of categoryItems) {
        menuText += `  - "${item.name}"`;
        if (item.sizes && item.sizes.length > 0) {
          const sizeText = item.sizes.map(s => `${s.name}:₹${s.price}`).join(', ');
          menuText += ` [Sizes: ${sizeText}]`;
        } else if (item.price) {
          menuText += ` [Price: ₹${item.price}]`;
        }
        if (item.is_customizable) {
          menuText += ' [Can add custom text]';
        }
        // Add available add-ons to the description for the AI
        // @ts-ignore
        if (item.add_ons && item.add_ons.length > 0) {
          // @ts-ignore
          const addOnText = item.add_ons.map(a => `${a.add_on.name} (₹${a.add_on.price})`).join(', ');
          menuText += ` [Available Add-ons: ${addOnText}]`;
        }
        if (item.special_notes) {
          menuText += ` [Note: ${item.special_notes}]`;
        }
        menuText += '\n';
      }
      menuText += '\n';
    }
  }

  return menuText;
}

function getSystemPrompt(context: AIContext): string {
  const today = new Date().toISOString().split('T')[0];
  const businessName = context.business?.name || 'our cafe';

  // Format menu with STRICT enforcement
  let menuSection = '';
  let itemNamesList = '';
  if (context.menuItems && context.menuItems.length > 0 && context.menuCategories) {
    menuSection = formatStrictMenuForAI(context.menuItems, context.menuCategories);
    itemNamesList = context.menuItems.map(item => `"${item.name}"`).join(', ');
  }

  // Format current session items
  let currentItemsSection = '';
  if (context.currentSessionItems && context.currentSessionItems.length > 0) {
    currentItemsSection = `\nITEMS ALREADY IN THIS ORDER:\n${context.currentSessionItems.map((item, i) => `${i + 1}. ${item}`).join('\n')}`;
  }

  return `You are an AI ordering assistant for ${businessName}.

${menuSection}
${currentItemsSection}

⚠️ CRITICAL - STRICT MENU RULES ⚠️
1. You can ONLY accept orders for items listed in AVAILABLE MENU ITEMS above
2. If customer asks for an item NOT in the menu, say "Sorry, we don't have [item]. We have [similar items from menu]."
3. NEVER invent or hallucinate items - NO Vanilla cake, NO items not in the list
4. Item names in your response MUST match EXACTLY from the menu list
5. Prices and sizes MUST match EXACTLY what's in the menu
6. If unsure about an item, ask customer to choose from the menu
7. If customer requests an available add-on (e.g., "with a candle"), include its name in the "add_ons" array in your JSON response.

VALID ITEM NAMES (use EXACTLY as written): [${itemNamesList}]

RESPONSE FORMAT (JSON only):
{
  "reply": "your message (1-2 sentences)",
  "intent": "add_item | modify_order | ask_question | ready_for_checkout | confirm_order | cancel | cancel_existing_order | smalltalk | show_menu | conversation_ended | item_not_available",
  "item": {
    "name": "EXACT name from menu",
    "quantity": 1,
    "size_or_weight": "EXACT size from menu",
    "custom_text": "for cakes only",
    "delivery_date": "YYYY-MM-DD",
    "notes": "special instructions",
    "add_ons": ["Name of add-on 1", "Name of add-on 2"]
  },
  "order_id": "8-character order ID (only for cancel_existing_order)"
}

INTENT RULES:
- "item_not_available": Customer asks for item NOT in menu → suggest alternatives from menu
- "add_item": ONLY when item exists in menu AND all details collected
- "modify_order": Customer wants to change quantity, remove item, or modify existing order → make changes and show NEW summary
- "ask_question": Need more details (size, date, quantity)
- "show_menu": Customer asks what's available
- "ready_for_checkout": Customer says "that's all", "done", "no more" → show order summary
- "confirm_order": ONLY when customer says "yes"/"confirm" AFTER seeing order summary with prices
- "cancel": Customer wants to cancel CURRENT order being built (before confirmation)
- "cancel_existing_order": Customer wants to cancel a PREVIOUSLY CONFIRMED order using order ID → extract the order_id
- "conversation_ended": After order is confirmed, customer says "okay", "thanks", "bye"

⚠️ CRITICAL ORDER FLOW:
1. Customer adds items → add_item
2. Customer says "that's all" → ready_for_checkout (system shows summary with prices)
3. Customer says "yes" to confirm → confirm_order
4. BUT if customer says "change X to Y" or "make it 2 burgers" → modify_order (system updates and shows NEW summary)
5. Customer confirms the NEW summary → confirm_order

⚠️ IMPORTANT: If customer says "yes" to confirm a CHANGE (not the order summary), use intent "modify_order" and acknowledge the change. ONLY use "confirm_order" when the last bot message was the order summary with prices.

EXAMPLES:

Customer: "I want vanilla cake"
{"reply": "Sorry, we don't have Vanilla cake. We have Black Forest, Chocolate Truffle, Pineapple Cake, Red Velvet, and Butterscotch. Which would you like?", "intent": "item_not_available"}

Customer: "Black Forest 2kg with a candle"
{"reply": "Great choice! When do you need the 2kg Black Forest cake with a candle?", "intent": "ask_question", "item": {"name": "Black Forest", "quantity": 1, "size_or_weight": "2kg", "add_ons": ["Candle"]}}

Customer: "Do you have pizza?"
{"reply": "Sorry, we don't have pizza. We have Sandwich, Burger, and Samosa in our snacks. Would you like any of these?", "intent": "item_not_available"}

Customer: "One coffee"
{"reply": "Sure! What size would you like - small (₹30), medium (₹50), or large (₹70)?", "intent": "ask_question", "item": {"name": "Coffee"}}

Customer: "thanks bye"
{"reply": "Thank you! Have a wonderful day! 🙏", "intent": "conversation_ended"}

--- MODIFY ORDER EXAMPLES ---

Bot showed summary, Customer: "I want 2 burgers instead"
{"reply": "Got it! I've updated your order to 2 Burgers.", "intent": "modify_order", "item": {"name": "Burger", "quantity": 2, "size_or_weight": "Medium"}}

Bot asked "Is that correct?", Customer: "Yes"
{"reply": "Perfect! Let me show you the updated order summary.", "intent": "modify_order"}

Bot showed summary, Customer: "Remove the coffee"
{"reply": "Done! I've removed the Coffee from your order.", "intent": "modify_order"}

Bot showed PRICE SUMMARY with "Reply YES to confirm", Customer: "Yes"
{"reply": "Processing your order...", "intent": "confirm_order"}

--- CANCEL ORDER EXAMPLES ---

Customer: "Cancel order 424bfda9"
{"reply": "I'll cancel order #424bfda9 for you.", "intent": "cancel_existing_order", "order_id": "424bfda9"}

Customer: "I want to cancel my order 12345678"
{"reply": "Let me cancel order #12345678.", "intent": "cancel_existing_order", "order_id": "12345678"}

Customer: "Cancel my order" OR "I want to cancel the order" OR "Cancel my last order" (NO order ID provided)
{"reply": "I'd be happy to help you cancel your order. Could you please provide the order ID? It's the 8-character code you received when you placed the order (e.g., 424bfda9).", "intent": "cancel_existing_order"}

Customer: "Remove the burger" OR "Cancel the coffee" (cancelling an ITEM, not the order)
{"reply": "Done! I've removed the Burger from your order.", "intent": "modify_order", "item": {"name": "Burger", "quantity": 0}}

Customer: "Never mind, I don't want to order anymore" (during ordering, wants to stop completely)
{"reply": "No problem! I've cancelled your current order. Feel free to start a new one anytime!", "intent": "cancel"}

⚠️ CANCEL INTENT RULES:
- "cancel_existing_order" WITH order_id: Customer gives order ID → cancel that specific order
- "cancel_existing_order" WITHOUT order_id: Customer wants to cancel but didn't give ID → ASK for order ID
- "modify_order" with quantity=0: Customer wants to remove a specific ITEM from current cart
- "cancel": Customer wants to abandon the current ordering session entirely (no items confirmed yet)

REMEMBER:
- ONLY items from the menu can be ordered
- NEVER make up items, prices, or sizes
- Be polite but firm about menu limitations
- When declining, always suggest available alternatives

Current date: ${today}`;
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
    };
  } catch (error) {
    logger.warn('Failed to parse AI response as JSON', { error, responseText });

    return {
      reply: "I'm sorry, I didn't catch that. Could you please say that again?",
      intent: 'ask_question',
    };
  }
}

// Validate that item name exists in menu
export function validateItemAgainstMenu(
  itemName: string,
  menuItems: MenuItem[]
): MenuItem | null {
  if (!itemName || !menuItems || menuItems.length === 0) {
    return null;
  }

  const normalizedInput = itemName.toLowerCase().trim();

  // Exact match first
  let found = menuItems.find(
    item => item.name.toLowerCase() === normalizedInput
  );

  // Partial match
  if (!found) {
    found = menuItems.find(
      item =>
        item.name.toLowerCase().includes(normalizedInput) ||
        normalizedInput.includes(item.name.toLowerCase())
    );
  }

  return found || null;
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

export async function processMessageWithAI(
  currentMessage: string,
  conversationHistory: Message[],
  _sessionContext: Session,
  context: AIContext = {}
): Promise<AIResponse> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    logger.error('Gemini API key not configured');
    throw new Error('AI service not configured');
  }

  const prompt = buildPrompt(currentMessage, conversationHistory, context);

  try {
    const response = await axios.post(
      `${GEMINI_API_URL}?key=${apiKey}`,
      {
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.3, // Lower temperature for more consistent responses
          maxOutputTokens: 500,
        },
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      }
    );

    const responseText =
      response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!responseText) {
      logger.error('Empty response from Gemini', response.data);
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

    logger.info(`AI Intent: ${aiResponse.intent}`);
    return aiResponse;

  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('Gemini API error', {
        status: error.response?.status,
        data: error.response?.data,
      });

      if (error.code === 'ECONNABORTED') {
        logger.info('Retrying AI request after timeout...');
        try {
          const retryResponse = await axios.post(
            `${GEMINI_API_URL}?key=${apiKey}`,
            {
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.3, maxOutputTokens: 500 },
            },
            { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
          );

          const retryText =
            retryResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (retryText) {
            return parseAIResponse(retryText);
          }
        } catch (retryError) {
          logger.error('Retry also failed', retryError);
        }
      }
    } else {
      logger.error('Unexpected AI error', error);
    }

    return {
      reply: "I'm sorry, I'm having trouble right now. Please try again.",
      intent: 'ask_question',
    };
  }
}
