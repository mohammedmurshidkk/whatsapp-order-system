// src/plugins/cake-cafe/index.ts
// Cake & Cafe Plugin - Main entry point

import {
  BusinessPlugin,
  PluginIntent,
  ConversationContext,
  IntentResult,
  ValidationResult,
  PluginPromptContext,
} from '../types';
import { Business, Session, Order } from '../../types';
import { getSystemPrompt, FoodOrderingPromptContext } from './prompts/systemPrompt';
import { FoodOrderingIntent } from './types';

// Import plugin-specific intent handler registry
import { executeHandler, hasHandler, handlerRegistry } from './handlers/registry';
import { IntentContext } from './handlers/types';
import { logger } from '../../utils/logger';

/**
 * Cake & Cafe Plugin
 *
 * Handles cake shop, bakery, and cafe ordering via WhatsApp.
 * Features:
 * - Menu browsing and item selection
 * - Cart management (add, modify, remove)
 * - Size/weight selection (kg-based pricing)
 * - Add-ons (candles, toppings, etc.)
 * - Custom text on cakes
 * - Delivery and takeaway fulfillment
 * - Custom cake quote workflow with image analysis
 * - Cake flavor pricing
 */
export const CakeCafePlugin: BusinessPlugin = {
  id: 'cake-cafe',
  name: 'Cake & Cafe',
  version: '1.0.0',

  /**
   * Generate the AI system prompt for this business
   */
  getSystemPrompt(business: Business, context: PluginPromptContext): string {
    // Transform PluginPromptContext to FoodOrderingPromptContext
    const foodContext: FoodOrderingPromptContext = {
      business,
      menuItems: context.menu,
      menuCategories: context.categories,
      outlets: context.outlets,
      // These will be populated by the caller in aiService
      currentSessionItems: [],
      sessionHasFulfillmentType: false,
      sessionHasDeliveryInfo: false,
      sessionHasPickupInfo: false,
      availableAddons: context.addons,
      customerLanguage: 'ml', // Default to Malayalam
    };

    return getSystemPrompt(foodContext);
  },

  /**
   * Get all intents supported by this plugin
   */
  getIntents(): PluginIntent[] {
    return [
      // Ordering intents
      {
        name: 'add_item',
        description: 'Customer wants to add an item to their cart',
        examples: ['I want a chocolate cake', 'Add 2 coffees', 'Rainbow 1kg'],
      },
      {
        name: 'modify_order',
        description: 'Customer wants to change quantity or remove items',
        examples: ['Remove the cake', 'Change quantity to 2', 'Make it 3 instead'],
      },
      {
        name: 'show_menu',
        description: 'Customer wants to see the menu',
        examples: ['Show menu', 'What do you have?', 'Menu please'],
      },
      {
        name: 'show_photos',
        description: 'Customer wants to see photos of items',
        examples: ['Show cake photos', 'Rainbow photo', 'Send picture of cakes'],
      },
      {
        name: 'show_popular_items',
        description: 'Customer wants to see popular/trending items',
        examples: ["What's good?", 'Best sellers', 'Popular items'],
      },
      {
        name: 'item_not_available',
        description: 'Item requested is not on the menu',
        examples: [],
      },

      // Addon intents
      {
        name: 'suggest_addons',
        description: 'System suggests add-ons for an item',
        examples: [],
      },
      {
        name: 'add_addon',
        description: 'Customer wants to add an add-on',
        examples: ['Add candles', 'Yes, add that', 'Include toppings'],
      },
      {
        name: 'decline_addon',
        description: 'Customer declines add-ons',
        examples: ['No thanks', 'Skip', "Don't need anything else"],
      },
      {
        name: 'remove_addon',
        description: 'Customer wants to remove an add-on',
        examples: ['Remove candles', 'No candles please'],
      },

      // Checkout intents
      {
        name: 'ready_for_checkout',
        description: 'Customer is done adding items',
        examples: ["That's all", 'Done', 'Nothing else', 'Checkout'],
      },
      {
        name: 'confirm_items',
        description: 'Customer confirms items in cart',
        examples: ['Yes', 'Confirm', "That's correct"],
      },

      // Fulfillment intents
      {
        name: 'ask_fulfillment_type',
        description: 'Ask customer for delivery or takeaway',
        examples: [],
      },
      {
        name: 'collect_delivery_info',
        description: 'Collecting delivery address and time',
        examples: ['MG Road, tomorrow 5pm', 'Deliver to my home at 6pm'],
      },
      {
        name: 'collect_pickup_info',
        description: 'Collecting pickup outlet and time',
        examples: ['Kochi outlet, today 4pm', "I'll pick up from Main branch"],
      },
      {
        name: 'confirm_order',
        description: 'Final order confirmation',
        examples: ['Yes', 'Confirm', 'Place order'],
      },

      // Cancel intents
      {
        name: 'cancel',
        description: 'Cancel current session/cart',
        examples: ['Cancel', 'Never mind', 'Start over'],
      },
      {
        name: 'cancel_existing_order',
        description: 'Cancel a previously placed order',
        examples: ['Cancel my order', 'Cancel OKS-123'],
      },
      {
        name: 'check_order_status',
        description: 'Check status of an existing order',
        examples: ['Where is my order?', 'Order status', 'Track my order'],
      },

      // Custom text intents
      {
        name: 'modify_custom_text',
        description: 'Change text written on cake',
        examples: ['Change text to Happy Birthday', 'Write "Congrats" on the cake'],
      },
      {
        name: 'remove_custom_text',
        description: 'Remove text from cake',
        examples: ['Remove the text', 'No text needed'],
      },

      // Custom cake intents
      {
        name: 'custom_cake_inquiry',
        description: 'Customer asking about custom cake design',
        examples: ['Can you make this cake?', 'Custom cake', 'Do you do custom designs?'],
      },

      // General intents
      {
        name: 'ask_question',
        description: 'Need more information from customer',
        examples: ['What size?', 'Which flavor?'],
      },
      {
        name: 'smalltalk',
        description: 'General conversation',
        examples: ['Hello', 'Thank you', 'Good morning'],
      },
      {
        name: 'conversation_ended',
        description: 'Conversation has ended',
        examples: ['Bye', 'See you', 'Thanks, goodbye'],
      },

      // Intervention intents
      {
        name: 'requires_intervention',
        description: 'Requires admin intervention (urgent orders, special requests)',
        examples: ['I need it in 10 minutes', 'Deliver to another city'],
      },

      // Amenity intents
      {
        name: 'amenity_inquiry',
        description: 'Customer asking about amenities (party hall, etc.)',
        examples: ['Do you have party hall?', 'Tell me about catering'],
      },
      {
        name: 'amenity_booking_request',
        description: 'Customer wants to book an amenity',
        examples: ['Book the party hall', 'Reserve for catering'],
      },
    ];
  },

  /**
   * Handle an intent
   * Routes to existing intent handlers
   */
  async handleIntent(
    intent: string,
    context: ConversationContext
  ): Promise<IntentResult> {
    // Check if handler exists for this intent
    if (!hasHandler(intent as any)) {
      logger.warn(`CakeCafePlugin: No handler for intent: ${intent}`);
      return {
        response: context.aiResponse.reply || "I'm not sure how to handle that. Could you rephrase?",
      };
    }

    // Build IntentContext from ConversationContext
    const intentContext: IntentContext = {
      phone: context.phone,
      businessId: context.business.id,
      business: context.business,
      customer: context.customer,
      session: context.session,
      lang: context.language as any,
      sessionWithItems: context.sessionWithItems as any,
      existingItems: context.cartItems,
      outlets: context.outlets,
      activeOrder: context.activeOrder,
      menuItems: context.menu,
      menuCategories: context.categories,
      amenities: context.amenities as any,
      messageText: context.message,
      originalMessage: context.originalMessage,
      businessTimezone: context.businessTimezone,
      isFirstMessage: context.isFirstMessage,
      // Messaging helpers from context
      sendWhatsAppMessage: context.messaging.sendWhatsAppMessage,
      sendButtons: context.messaging.sendButtons,
      sendList: context.messaging.sendList,
      sendLocation: context.messaging.sendLocation,
      sendDoc: context.messaging.sendDoc,
      sendImage: context.messaging.sendImage,
      saveOutgoingMessage: context.messaging.saveOutgoingMessage,
      saveIncomingMessage: context.messaging.saveIncomingMessage,
    };

    // Execute the handler
    const result = await executeHandler(intent as any, intentContext, context.aiResponse as any);

    if (!result) {
      return {
        response: context.aiResponse.reply || "I'm not sure how to handle that.",
      };
    }

    return {
      response: result.reply || '',
      skipResponse: result.reply === null,
    };
  },

  /**
   * Called when a new session starts
   */
  async onSessionStart(session: Session): Promise<void> {
    logger.info(`CakeCafePlugin: Session started: ${session.id}`);
    // Could initialize cart, send welcome message, etc.
  },

  /**
   * Called when a session ends
   */
  async onSessionEnd(session: Session): Promise<void> {
    logger.info(`CakeCafePlugin: Session ended: ${session.id}`);
    // Could clean up cart, send feedback request, etc.
  },

  /**
   * Called when an order is completed
   */
  async onOrderComplete(order: Order): Promise<void> {
    logger.info(`CakeCafePlugin: Order completed: ${order.order_number}`);
    // Could trigger notifications, analytics, etc.
  },

  /**
   * Validate business configuration for this plugin
   */
  validateBusinessConfig(business: Business): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check required fields
    if (!business.name) {
      errors.push('Business name is required');
    }

    // Check fulfillment configuration
    if (!business.supports_delivery && !business.supports_takeaway) {
      warnings.push('Neither delivery nor takeaway is enabled. Customers cannot place orders.');
    }

    // Check menu
    // Note: Menu validation would need to be done separately with menu data

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  },
};

export default CakeCafePlugin;
