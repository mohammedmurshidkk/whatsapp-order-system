import axios from 'axios';
import { Message, AIResponse, Session, Business, MenuItem, MenuCategory, AIFulfillmentResponse } from '../types';
import { GEMINI_MODEL } from '../config/constants';
import { formatMessagesForAI } from './messageService';
import { logger } from '../utils/logger';

const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export interface AIContext {
  business?: Business;
  menuItems?: MenuItem[];
  menuCategories?: MenuCategory[];
  currentSessionItems?: string[];
  session?: Session;
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
  const sessionState = context.session?.session_state || 'ordering';

  let menuSection = '';
  let itemNamesList = '';
  if (context.menuItems && context.menuItems.length > 0 && context.menuCategories) {
    menuSection = formatStrictMenuForAI(context.menuItems, context.menuCategories);
    itemNamesList = context.menuItems.map(item => `"${item.name}"`).join(', ');
  }

  let currentItemsSection = '';
  if (context.currentSessionItems && context.currentSessionItems.length > 0) {
    currentItemsSection = `\nITEMS ALREADY IN THIS ORDER:\n${context.currentSessionItems.map((item, i) => `${i + 1}. ${item}`).join('\n')}`;
  }

  return `You are an AI ordering assistant for ${businessName}.
Current conversation state: ${sessionState}
Current date is ${today}.

${menuSection}
${currentItemsSection}

⚠️ CRITICAL - STRICT MENU RULES ⚠️
1.  You can ONLY accept orders for items listed in AVAILABLE MENU ITEMS above.
2.  If customer asks for an item NOT in the menu, say "Sorry, we don't have [item]. We have [similar items from menu]."
3.  NEVER invent or hallucinate items. Item names in your response MUST match EXACTLY from the menu list.
4.  If customer requests an available add-on (e.g., "with a candle"), include its name in the "add_ons" array.

VALID ITEM NAMES (use EXACTLY as written): [${itemNamesList}]

RESPONSE FORMAT (JSON only):
{
  "reply": "your message (1-2 sentences)",
  "intent": "add_item | modify_order | ...",
  "item": { "name": "...", "quantity": 1, "add_ons": ["..."] },
  "fulfillment": { "type": "delivery|takeaway", "address": "...", "outlet": "...", "time": "YYYY-MM-DD HH:mm:ss" },
  "order_id": "..."
}

INTENT RULES:
- "item_not_available": Customer asks for item NOT in menu.
- "add_item": Customer adds a valid item.
- "modify_order": Customer wants to change quantity or remove an item.
- "ask_question": You need more details (size, date, etc.).
- "show_menu": Customer asks what's available.
- "ready_for_checkout": Customer says "that's all", "done", "no more".
- "confirm_order": Customer says "yes"/"confirm" AFTER seeing the final summary with prices.
- "cancel": Customer wants to cancel the current order before confirmation.
- "set_order_type": Customer chooses "delivery" or "takeaway".
- "provide_fulfillment_details": Customer gives address, pickup outlet, or time.

⚠️ CONVERSATION FLOW ⚠️
1.  Ordering Phase (state: 'ordering'): Customer adds/modifies items. If they say "that's all", use 'ready_for_checkout'.
2.  Fulfillment Phase (state: 'awaiting_fulfillment_type'): The system has just asked "takeaway or delivery?". Your job is to understand their choice.
3.  Details Phase (state: 'awaiting_delivery_details' or 'awaiting_takeaway_details'): The system has asked for address/time. Your job is to extract these details.
4.  Confirmation Phase (state: 'awaiting_confirmation'): The system has shown the final summary. Your ONLY job is to see if the user says "yes" or "confirm" and use 'confirm_order'.

--- FULFILLMENT FLOW ---
-   CRITICAL TIME RULE: When extracting a fulfillment time, you MUST normalize it to a "YYYY-MM-DD HH:mm:ss" format. Use the current date (${today}) as the reference. If the user says 'tomorrow', use the next day's date. Convert all AM/PM times to 24-hour format.
-   If current state is 'awaiting_fulfillment_type' and user says "delivery", your response:
    {"reply": "Got it, delivery.", "intent": "set_order_type", "fulfillment": {"type": "delivery"}}
-   If current state is 'awaiting_fulfillment_type' and user says "I'll pick it up", your response:
    {"reply": "Okay, takeaway.", "intent": "set_order_type", "fulfillment": {"type": "takeaway"}}
-   If current state is 'awaiting_delivery_details' and user says "123 Main St at 7pm", your response:
    {"reply": "OK, delivery to 123 Main St at 7pm.", "intent": "provide_fulfillment_details", "fulfillment": {"address": "123 Main St", "time": "${today} 19:00:00"}}
-   If current state is 'awaiting_takeaway_details' and user says "I'll pick up from the downtown location tomorrow around 8.", your response:
    {"reply": "Sounds good.", "intent": "provide_fulfillment_details", "fulfillment": {"outlet": "downtown location", "time": "2025-12-01 08:00:00"}}

--- OTHER EXAMPLES ---
Customer: "I want vanilla cake"
{"reply": "Sorry, we don't have Vanilla cake. We have Black Forest, Chocolate Truffle, etc.", "intent": "item_not_available"}

Customer: "Black Forest 2kg with a candle"
{"reply": "Great choice! When do you need it?", "intent": "ask_question", "item": {"name": "Black Forest", "quantity": 1, "size_or_weight": "2kg", "add_ons": ["Candle"]}}

Bot showed PRICE SUMMARY with "Reply YES to confirm", Customer: "Yes"
{"reply": "Processing your order...", "intent": "confirm_order"}

REMEMBER:
- Be polite but firm about menu limitations.
- When declining, always suggest available alternatives.

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
      fulfillment: parsed.fulfillment, // new
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
  session: Session,
  context: AIContext = {}
): Promise<AIResponse> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    logger.error('Gemini API key not configured');
    throw new Error('AI service not configured');
  }

  const fullContext = { ...context, session };
  const prompt = buildPrompt(currentMessage, conversationHistory, fullContext);

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
          temperature: 0.2,
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

    // VALIDATION LOGIC
    if (aiResponse.intent === 'add_item' && aiResponse.item?.name && context.menuItems) {
      const validItem = validateItemAgainstMenu(aiResponse.item.name, context.menuItems);
      if (!validItem) {
        logger.warn(`AI tried to add non-menu item: ${aiResponse.item.name}`);
        aiResponse.reply = `Sorry, "${aiResponse.item.name}" is not on our menu.`;
        aiResponse.intent = 'item_not_available';
      } else {
        aiResponse.item.name = validItem.name; // Correct name
      }
    }
    
    logger.info(`AI Intent: ${aiResponse.intent} (State: ${session.session_state})`);
    return aiResponse;

  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('Gemini API error', {
        status: error.response?.status,
        data: error.response?.data,
      });
    } else {
      logger.error('Unexpected AI error', error);
    }

    return {
      reply: "I'm sorry, I'm having trouble right now. Please try again.",
      intent: 'ask_question',
    };
  }
}
