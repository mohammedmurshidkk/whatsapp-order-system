/**
 * Mock AI Service
 * Returns predictable responses based on input patterns
 * Used for testing without hitting real AI API
 */

// Use a partial type for mock responses since we don't always need all fields
export interface MockAIResponse {
  reply: string;
  intent: string;
  item?: {
    name: string;
    quantity?: number;
    size_or_weight?: string;
  };
  fulfillment?: {
    fulfillment_type?: string;
    delivery_address?: string;
    delivery_time?: string;
    pickup_outlet_id?: string;
    pickup_time?: string;
  };
  customText?: string;
  order_id?: string;
  addon?: {
    addon_name: string;
  };
}

interface PatternRule {
  pattern: RegExp;
  response: (match: RegExpMatchArray, context: MockContext) => MockAIResponse;
}

export interface MockContext {
  cartItems: string[];
  hasFulfillmentType: boolean;
  hasDeliveryAddress: boolean;
  hasPickupOutlet: boolean;
  hasTime: boolean;
  lastItemName?: string;
  menuItems: string[];
  pendingCustomText?: boolean;
}

/**
 * Pattern-based response rules
 * Order matters - first match wins
 */
const PATTERN_RULES: PatternRule[] = [
  // Greetings
  {
    pattern: /^(hi|hello|hey|hlo|hii)$/i,
    response: () => ({
      reply: "Hello! 👋 What would you like to order today?",
      intent: 'ask_question',
    }),
  },

  // Show menu
  {
    pattern: /\b(show|see|view)\s*(the\s*)?(menu|items|options)\b/i,
    response: () => ({
      reply: "Here's our menu!",
      intent: 'show_menu',
    }),
  },

  // Add item with size - "Black Forest 1kg", "Rainbow 500g", "burger large"
  {
    pattern: /\b(black\s*forest|rainbow|chocolate|vanilla|burger)\s*(1\s*kg|500\s*g|large|small|medium)\b/i,
    response: (match) => {
      const itemName = match[1].replace(/\s+/g, ' ').trim();
      const size = match[2].trim();
      // Capitalize first letter of each word
      const formattedName = itemName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
      return {
        reply: `Added ${formattedName} (${size}) to your cart! Anything else?`,
        intent: 'add_item',
        item: { name: formattedName, quantity: 1, size_or_weight: size },
      };
    },
  },

  // "Also add" pattern - "Also add a burger large"
  {
    pattern: /\b(also\s+)?(add|want|get)\s+(a\s+)?(black\s*forest|rainbow|chocolate|vanilla|burger)\s*(1\s*kg|500\s*g|large|small|medium)?\b/i,
    response: (match) => {
      const itemName = match[4].replace(/\s+/g, ' ').trim();
      const size = match[5]?.trim();
      const formattedName = itemName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

      if (size) {
        return {
          reply: `Added ${formattedName} (${size}) to your cart! Anything else?`,
          intent: 'add_item',
          item: { name: formattedName, quantity: 1, size_or_weight: size },
        };
      }
      return {
        reply: `What size would you like for ${formattedName}?`,
        intent: 'ask_question',
        item: { name: formattedName },
      };
    },
  },

  // Add item - size specified separately (after asking)
  {
    pattern: /^(1\s*kg|500\s*g|large|small|medium)$/i,
    response: (match, context) => {
      const size = match[1].trim();
      const itemName = context.lastItemName || 'Item';
      return {
        reply: `Added ${itemName} (${size}) to your cart! Anything else?`,
        intent: 'add_item',
        item: { name: itemName, quantity: 1, size_or_weight: size },
      };
    },
  },

  // Add item without size - ask for size
  {
    pattern: /^(black\s*forest|cake|rainbow|chocolate|vanilla)$/i,
    response: (match) => {
      let itemName = match[1].trim();
      if (itemName.toLowerCase() === 'cake') itemName = 'Black Forest';
      const formattedName = itemName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
      return {
        reply: `Great choice! What size would you like - 500g or 1kg?`,
        intent: 'ask_question',
        item: { name: formattedName },
      };
    },
  },

  // Burger without size
  {
    pattern: /^burger$/i,
    response: () => ({
      reply: "Great choice! What size - Small or Large?",
      intent: 'ask_question',
      item: { name: 'Burger' },
    }),
  },

  // Ready for checkout - "that's all", "done", "no more", "nothing", "no", "mathi"
  {
    pattern: /^(that'?s?\s*all|done|no\s*more|nothing|no|mathi|checkout)$/i,
    response: (_, context) => {
      if (context.cartItems.length === 0) {
        return {
          reply: "Your cart is empty! What would you like to order?",
          intent: 'ask_question',
        };
      }
      return {
        reply: "Here's your order summary.",
        intent: 'ready_for_checkout',
      };
    },
  },

  // Delivery selection
  {
    pattern: /^(delivery)$/i,
    response: () => ({
      reply: "Please share your delivery address and preferred time.",
      intent: 'ask_question',
      fulfillment: { fulfillment_type: 'delivery' },
    }),
  },

  // Takeaway selection
  {
    pattern: /^(takeaway|pickup|take\s*away)$/i,
    response: () => ({
      reply: "Please select your pickup location.",
      intent: 'ask_question',
      fulfillment: { fulfillment_type: 'takeaway' },
    }),
  },

  // Address with time - "MG Road, tomorrow 5pm", "Kottakkal, nale 5pm"
  {
    pattern: /^(.+?),\s*(today|tomorrow|nale|innu)\s*(\d{1,2}\s*(am|pm)?)/i,
    response: (match) => {
      const address = match[1].trim();
      const time = `${match[2]} ${match[3]}`.trim();
      return {
        reply: `Delivery to ${address} at ${time}. Please confirm YES.`,
        intent: 'collect_delivery_info',
        fulfillment: {
          fulfillment_type: 'delivery',
          delivery_address: address,
          delivery_time: time,
        },
      };
    },
  },

  // Address only (when in fulfillment flow) - matches place names
  {
    pattern: /^([a-zA-Z][a-zA-Z\s]{2,})$/i,
    response: (match, context) => {
      const text = match[1].trim();

      // If has fulfillment type, treat as address
      if (context.hasFulfillmentType && !context.hasDeliveryAddress) {
        return {
          reply: `Got it, ${text}. What time would you like delivery?`,
          intent: 'ask_question',
          fulfillment: {
            fulfillment_type: 'delivery',
            delivery_address: text,
          },
        };
      }

      // Otherwise, it's probably something else - fallback
      return {
        reply: "What would you like to order?",
        intent: 'ask_question',
      };
    },
  },

  // Time only - "today 5pm", "tomorrow 10am", "nale 9am", "Nale 9AM"
  {
    pattern: /^(today|tomorrow|nale|innu)\s*(\d{1,2}\s*(am|pm)?)/i,
    response: (match) => {
      const time = `${match[1]} ${match[2]}`.trim();
      return {
        reply: `Time set to ${time}. Please confirm YES.`,
        intent: 'collect_delivery_info',
        fulfillment: { delivery_time: time },
      };
    },
  },

  // Outlet selection - "Bun Studio cafe"
  {
    pattern: /\b(bun\s*studio|outlet\s*\d+)\b/i,
    response: (match) => {
      const outlet = match[1].trim();
      return {
        reply: `Pickup at: ${outlet}. When would you like to pick up?`,
        intent: 'collect_pickup_info',
        fulfillment: {
          fulfillment_type: 'takeaway',
          pickup_outlet_id: 'outlet-1',
        },
      };
    },
  },

  // Confirmation - "yes", "confirm", "ok", "sheri", "sheriya"
  {
    pattern: /^(yes|confirm|ok|okay|sheri|sheriya)$/i,
    response: (_, context) => {
      if (context.hasDeliveryAddress || context.hasPickupOutlet) {
        return {
          reply: "Order confirmed! Thank you.",
          intent: 'confirm_order',
        };
      }
      return {
        reply: "What would you like to confirm?",
        intent: 'ask_question',
      };
    },
  },

  // Modify custom text - "change text to Happy Birthday", "Change the text to Happy Birthday"
  {
    pattern: /\b(change|update|modify)\s*(the\s*)?(text|message|writing)\s*(to|into)?\s*["']?(.+?)["']?\s*$/i,
    response: (match) => {
      const newText = match[5]?.trim();
      if (newText) {
        return {
          reply: `Updated the cake message to "${newText}".`,
          intent: 'modify_custom_text',
          customText: newText,
        };
      }
      return {
        reply: "What would you like the new message to be?",
        intent: 'modify_custom_text',
      };
    },
  },

  // Add custom text - "add Happy Birthday on cake", "Add writing on cake"
  {
    pattern: /\b(add|write)\s*(["']?.+?["']?)?\s*(on|to)\s*(the\s*)?(cake|item)/i,
    response: (match) => {
      const text = match[2]?.replace(/["']/g, '').trim();
      if (text && text.toLowerCase() !== 'writing' && text.toLowerCase() !== 'text') {
        return {
          reply: `Added "${text}" to your cake.`,
          intent: 'modify_custom_text',
          customText: text,
        };
      }
      return {
        reply: "What would you like the message to be?",
        intent: 'modify_custom_text',
      };
    },
  },

  // Remove custom text - "remove the writing", "no text", "remove writing"
  {
    pattern: /\b(remove|delete|no)\s*(the\s*)?(text|message|writing)\b/i,
    response: () => ({
      reply: "I've removed the text from your cake.",
      intent: 'remove_custom_text',
    }),
  },

  // Cancel order with ID - "Cancel order UPS-1"
  {
    pattern: /\bcancel\s*(order)?\s*(#?\s*)?([A-Z]{2,3}-?\d+)/i,
    response: (match) => {
      const orderId = match[3];
      return {
        reply: `Cancelling order ${orderId}.`,
        intent: 'cancel_existing_order',
        order_id: orderId,
      };
    },
  },

  // Cancel order without ID - "Cancel my order"
  {
    pattern: /\bcancel\s*(my\s*)?(order|orders?)\b/i,
    response: () => ({
      reply: "Please provide your order number to cancel.",
      intent: 'cancel_existing_order',
    }),
  },

  // Check order status with ID - "Status of UPS-2"
  {
    pattern: /\b(status|where|track)\s*(of|is)?\s*(order)?\s*(#?\s*)?([A-Z]{2,3}-?\d+)/i,
    response: (match) => {
      const orderId = match[5];
      return {
        reply: `Checking status of ${orderId}.`,
        intent: 'check_order_status',
        order_id: orderId,
      };
    },
  },

  // Check order status without ID - "Where is my order"
  {
    pattern: /\b(where\s*is|status\s*of|track)\s*(my\s*)?(order|orders?)\b/i,
    response: () => ({
      reply: "Please provide your order number.",
      intent: 'check_order_status',
    }),
  },

  // Remove addon - "Remove candle", "No silver coat"
  {
    pattern: /\b(remove|no|cancel|don'?t\s*want)\s*(the\s*)?(candle|silver\s*coat|packing)\b/i,
    response: (match) => {
      const addonName = match[3].trim();
      return {
        reply: `Removed ${addonName} from your order.`,
        intent: 'remove_addon',
        addon: { addon_name: addonName },
      };
    },
  },

  // Quantity change - "make it 2", "change to 3"
  {
    pattern: /\b(make\s*it|change\s*to|i\s*want)\s*(\d+)\b/i,
    response: (match, context) => {
      const quantity = parseInt(match[2]);
      return {
        reply: `Changed quantity to ${quantity}.`,
        intent: 'modify_order',
        item: { name: context.lastItemName || 'Item', quantity },
      };
    },
  },

  // Pending custom text response - any text when waiting for custom text
  {
    pattern: /^(.+)$/,
    response: (match, context) => {
      if (context.pendingCustomText) {
        const text = match[1].trim();
        return {
          reply: `Updated the cake message to "${text}".`,
          intent: 'modify_custom_text',
          customText: text,
        };
      }
      // Fallback
      return {
        reply: "I didn't quite understand. Could you please rephrase?",
        intent: 'ask_question',
      };
    },
  },
];

/**
 * Mock AI service that returns predictable responses
 */
export class MockAIService {
  private context: MockContext;

  constructor(menuItems: string[] = ['Black Forest', 'Burger', 'Rainbow']) {
    this.context = {
      cartItems: [],
      hasFulfillmentType: false,
      hasDeliveryAddress: false,
      hasPickupOutlet: false,
      hasTime: false,
      menuItems,
      pendingCustomText: false,
    };
  }

  /**
   * Process a message and return mock AI response
   */
  processMessage(message: string): MockAIResponse {
    const normalizedMessage = message.trim();

    for (const rule of PATTERN_RULES) {
      const match = normalizedMessage.match(rule.pattern);
      if (match) {
        const response = rule.response(match, this.context);

        // Update context based on response
        this.updateContext(response);

        return response;
      }
    }

    // Should never reach here due to fallback pattern
    return {
      reply: "I'm not sure what you mean.",
      intent: 'ask_question',
    };
  }

  /**
   * Update context based on AI response
   */
  private updateContext(response: MockAIResponse): void {
    // Track pending custom text
    if (response.intent === 'modify_custom_text' && !response.customText) {
      this.context.pendingCustomText = true;
    } else if (response.intent === 'modify_custom_text' && response.customText) {
      this.context.pendingCustomText = false;
    }

    if (response.intent === 'add_item' && response.item?.name) {
      const itemDesc = response.item.size_or_weight
        ? `${response.item.name} (${response.item.size_or_weight})`
        : response.item.name;
      this.context.cartItems.push(itemDesc);
      this.context.lastItemName = response.item.name;
    }

    if (response.intent === 'ask_question' && response.item?.name) {
      this.context.lastItemName = response.item.name;
    }

    if (response.fulfillment?.fulfillment_type) {
      this.context.hasFulfillmentType = true;
    }

    if (response.fulfillment?.delivery_address) {
      this.context.hasDeliveryAddress = true;
    }

    if (response.fulfillment?.pickup_outlet_id) {
      this.context.hasPickupOutlet = true;
    }

    if (response.fulfillment?.delivery_time || response.fulfillment?.pickup_time) {
      this.context.hasTime = true;
    }

    if (response.intent === 'confirm_order') {
      // Reset context after order
      this.resetContext();
    }
  }

  /**
   * Reset context for new session
   */
  resetContext(): void {
    this.context = {
      ...this.context,
      cartItems: [],
      hasFulfillmentType: false,
      hasDeliveryAddress: false,
      hasPickupOutlet: false,
      hasTime: false,
      lastItemName: undefined,
      pendingCustomText: false,
    };
  }

  /**
   * Get current context (for assertions)
   */
  getContext(): MockContext {
    return { ...this.context };
  }

  /**
   * Set context (for test setup)
   */
  setContext(partial: Partial<MockContext>): void {
    this.context = { ...this.context, ...partial };
  }
}

// Singleton instance for easy import
let mockInstance: MockAIService | null = null;

export function getMockAIService(): MockAIService {
  if (!mockInstance) {
    mockInstance = new MockAIService();
  }
  return mockInstance;
}

export function resetMockAIService(): void {
  mockInstance = null;
}
