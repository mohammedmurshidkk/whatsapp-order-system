// src/plugins/food-ordering/prompts/systemPrompt.ts
// AI system prompt for food ordering plugin

import { Business, MenuItem, MenuCategory, BusinessOutlet, MenuAddon, BusinessAmenity } from '../../../types';
import { PluginPromptContext, SessionItem } from '../../types';
import { formatWeight } from '../../../utils/weightUtils';
import { logger } from '../../../utils/logger';

export interface PopularItem {
  sizes: any[];
  description: any;
  base_price: any;
  item_name: string;
}

export interface FoodOrderingPromptContext extends PluginPromptContext {
  business?: Business;
  menuItems?: MenuItem[];
  menuCategories?: MenuCategory[];
  currentSessionItems?: string[];
  outlets?: BusinessOutlet[];
  sessionHasFulfillmentType?: boolean;
  sessionHasDeliveryInfo?: boolean;
  sessionHasPickupInfo?: boolean;
  availableAddons?: MenuAddon[];
  lastAddedItemId?: string;
  amenities?: BusinessAmenity[];
  customerLanguage?: 'en' | 'ml';
  popularItems?: PopularItem[];
  activeOrder?: {
    order_number: string;
    status: string;
    total_amount: number;
    fulfillment_type?: string | null;
    created_at: string;
  } | null;
}

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
  if (totalMins < 0) totalMins += 24 * 60;
  const newHours = Math.floor(totalMins / 60) % 24;
  const newMins = totalMins % 60;
  return `${String(newHours).padStart(2, '0')}:${String(newMins).padStart(2, '0')}`;
}

// Format menu for AI - includes item names, sizes, AND PRICES
function formatStrictMenuForAI(items: MenuItem[], categories: MenuCategory[]): string {
  if (items.length === 0) {
    return 'MENU: No items available.';
  }

  const categoryById = new Map(categories.map(c => [c.id, c]));
  const categoryMap = new Map<string, string[]>();

  for (const item of items) {
    if (item.category_id) {
      const existing = categoryMap.get(item.category_id) || [];

      let itemText = item.name;
      if (item.sizes && item.sizes.length > 0) {
        const sizePrices = item.sizes.map(s => `${s.name}: ₹${s.price}`).join(', ');
        itemText += ` [${sizePrices}]`;
      } else if (item.price) {
        itemText += ` [₹${item.price}]`;
      }
      if (item.description) {
        itemText += ` - ${item.description}`;
      }

      existing.push(itemText);
      categoryMap.set(item.category_id, existing);
    }
  }

  let menuText = `AVAILABLE MENU (with prices):\n\n`;
  const customWeightCategories: string[] = [];

  for (const category of categories) {
    const categoryItems = categoryMap.get(category.id);
    if (categoryItems && categoryItems.length > 0) {
      menuText += `${category.name}:\n`;
      categoryItems.forEach(item => {
        menuText += `  - ${item}\n`;
      });

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

/**
 * Generate the system prompt for food ordering AI
 */
export function getSystemPrompt(context: FoodOrderingPromptContext): string {
  const businessName = context.business?.name || 'our cafe';
  const minWait = context.business?.minimum_wait_minutes || 30;

  // Format menu with STRICT enforcement
  let menuSection = '';
  let itemNamesList = '';
  if (context.menuItems && context.menuItems.length > 0 && context.menuCategories) {
    menuSection = formatStrictMenuForAI(context.menuItems, context.menuCategories);
    itemNamesList = context.menuItems.map(item => `"${item.name}"`).join(', ');
  }

  let popularItemsSection = '';
  if (context.popularItems && context.popularItems.length > 0) {
    popularItemsSection += `\n\nPOPULAR ITEMS (recommend when asked "what's good", "best seller", etc.):\n`;
    popularItemsSection += context.popularItems.map((item, i) => {
      let itemDetails = `${i + 1}. ${item.item_name}`;
      if (item.description) itemDetails += ` - ${item.description}`;
      if (item.sizes && item.sizes.length > 0) {
        const priceRange = item.sizes.map((s: any) => `${s.name}: ₹${s.price}`).join(', ');
        itemDetails += ` (${priceRange})`;
      } else if (item.base_price) {
        itemDetails += ` - ₹${item.base_price}`;
      }
      return itemDetails;
    }).join('\n');
    popularItemsSection += `\n⚠️ IMPORTANT: When user asks for popular/trending/best items, use intent "show_popular_items". The handler will display items with images.\n`;
  }

  // Format outlets for takeaway
  let outletsSection = '';
  if (context.outlets && context.outlets.length > 0) {
    outletsSection = `\nAVAILABLE OUTLETS FOR PICKUP:\n`;
    context.outlets.forEach((outlet, i) => {
      let outletLine = `${i + 1}. "${outlet.outlet_name}" - ${outlet.address}`;

      if (outlet.opening_time && outlet.closing_time) {
        const openBuffer = outlet.opening_buffer_minutes || 0;
        const closeBuffer = outlet.closing_buffer_minutes || 0;
        const effectiveOpen = addMinutesToTime(outlet.opening_time, openBuffer);
        const effectiveClose = subtractMinutesFromTime(outlet.closing_time, closeBuffer);

        outletLine += ` | Hours: ${outlet.opening_time}-${outlet.closing_time}`;
        outletLine += ` (Delivery/Takeaway: ${effectiveOpen}-${effectiveClose})`;

        if (outlet.opening_days && outlet.opening_days.length > 0 && outlet.opening_days.length < 7) {
          const days = outlet.opening_days.map(d => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(', ');
          outletLine += ` | Open: ${days}`;
        }
      }
      outletsSection += outletLine + '\n';
    });

    if (context.outlets.some(o => o.opening_time && o.closing_time)) {
      outletsSection += `\n⏰ TIME VALIDATION: Delivery/takeaway times must be within outlet operating hours (adjusted for buffer).`;
      outletsSection += `\nIf customer chooses a time outside operating hours, politely suggest another time within hours.`;
      if (context.business?.customer_support_phone) {
        outletsSection += `\nFor special requests outside hours, contact: ${context.business.customer_support_phone}`;
      }
    }
  }

  // Business-specific custom instructions
  let customInstructions = '';
  if (context.business?.custom_ai_prompt) {
    customInstructions = `\n🏪 BUSINESS-SPECIFIC INSTRUCTIONS:\n${context.business.custom_ai_prompt}\n`;
  }

  // Customer support number
  let customerSupportSection = '';
  if (context.business?.customer_support_phone) {
    customerSupportSection = `\n📞 CUSTOMER SUPPORT: ${context.business.customer_support_phone}\nIf customer asks for help, support, contact number, or has issues outside your capabilities, provide this number.\n`;
  }

  // Format amenities
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
${popularItemsSection}
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
Customer: "Honey Almond send photo" → {"reply": "ഇതာ!", "intent": "show_photos", "photoRequest": {"item_name": "Honey Almond"}}
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

  // DYNAMIC SECTION
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const currentTime = now.toTimeString().split(' ')[0].substring(0, 5);

  let currentItemsSection = '';
  let hasItemsInCart = false;
  if (context.currentSessionItems && context.currentSessionItems.length > 0) {
    hasItemsInCart = true;
    currentItemsSection = `🛒 ITEMS IN CART:\n${context.currentSessionItems.map((item, i) => `${i + 1}. ${item}`).join('\n')}`;
  } else {
    currentItemsSection = `🛒 CART IS EMPTY`;
  }

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

  const readyForFinalConfirm = context.sessionHasFulfillmentType &&
    (context.sessionHasDeliveryInfo || context.sessionHasPickupInfo);
  if (readyForFinalConfirm) {
    fulfillmentStatus += ' 🎯 READY FOR CONFIRM - if customer says YES use "confirm_order"';
  }

  let addonsSection = '';
  if (context.availableAddons && context.availableAddons.length > 0) {
    addonsSection = `\nADD-ONS AVAILABLE: ${context.availableAddons.map(a => `"${a.name}" (${a.price !== null ? `₹${a.price}` : 'FREE'})`).join(', ')}`;
  }

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

  const dynamicContext = `

--- CURRENT SESSION STATE ---
Date: ${today}, Time: ${currentTime}
${currentItemsSection}
${fulfillmentStatus}${addonsSection}${activeOrderSection}
${hasItemsInCart ? 'Customer: "That\'s all" → {"reply": "Here\'s your summary.", "intent": "ready_for_checkout"}' : 'Customer: "That\'s all" → {"reply": "Cart is empty!", "intent": "ask_question"}'}`;

  return staticPrompt + dynamicContext;
}
