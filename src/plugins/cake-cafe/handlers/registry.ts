/**
 * Intent Handler Registry
 *
 * Central registry that maps AI intents to their handlers.
 * Handlers are loaded lazily to improve startup time.
 */

import { AIIntent, AIResponse } from '@/types';
import { IntentContext, IntentResult, IntentHandlerRegistry, HandlerEntry } from './types';
import { logger } from '@/utils/logger';

// Import handlers
import { simpleHandlers } from './simple/SimpleHandlers';
import { addonHandlers } from './addons/AddonHandlers';
import { customTextHandlers } from './custom/CustomTextHandlers';
import { modifyOrderHandler } from './order/ModifyOrderHandler';
import { addItemHandler } from './order/AddItemHandler';
import { showMenuHandler } from './menu/ShowMenuHandler';
import { showPhotosHandler } from './menu/ShowPhotosHandler';
import { showPopularItemsHandler } from './menu/ShowPopularItemsHandler';
import { readyForCheckoutHandler } from './fulfillment/ReadyForCheckoutHandler';
import { collectDeliveryInfoHandler } from './fulfillment/CollectDeliveryInfoHandler';
import { collectPickupInfoHandler } from './fulfillment/CollectPickupInfoHandler';
import { confirmOrderHandler } from './order/ConfirmOrderHandler';
import { askQuestionHandler } from './misc/AskQuestionHandler';
import { interventionHandler } from './misc/InterventionHandler';
import { customCakeHandler } from './custom/CustomCakeHandler';
import { orderStatusHandler } from './order/OrderStatusHandler';
import { amenityHandlers } from './misc/AmenityHandlers';

/**
 * Master registry of all intent handlers.
 * Each intent maps to a handler function or handler instance.
 */
const handlerRegistry: IntentHandlerRegistry = {
  // Simple handlers (low complexity, grouped)
  ...simpleHandlers,

  // Addon handlers
  ...addonHandlers,

  // Custom text handlers
  ...customTextHandlers,

  // Order handlers
  add_item: addItemHandler,
  modify_order: modifyOrderHandler,
  confirm_order: confirmOrderHandler,
  check_order_status: orderStatusHandler,

  // Menu handlers
  show_menu: showMenuHandler,
  show_photos: showPhotosHandler,
  show_popular_items: showPopularItemsHandler,

  // Fulfillment handlers
  ready_for_checkout: readyForCheckoutHandler,
  collect_delivery_info: collectDeliveryInfoHandler,
  collect_pickup_info: collectPickupInfoHandler,

  // Misc handlers
  ask_question: askQuestionHandler,
  requires_intervention: interventionHandler,
  custom_cake_inquiry: customCakeHandler,

  // Amenity handlers
  ...amenityHandlers,
};

/**
 * Execute a handler for the given intent.
 *
 * @param intent - The AI intent to handle
 * @param ctx - Shared context for the handler
 * @param aiResponse - AI response data
 * @returns IntentResult or null if no handler found
 */
export async function executeHandler(
  intent: AIIntent,
  ctx: IntentContext,
  aiResponse: AIResponse
): Promise<IntentResult | null> {
  const handler = handlerRegistry[intent];

  if (!handler) {
    logger.warn(`No handler registered for intent: ${intent}`);
    return null;
  }

  try {
    // Handler can be a function or an object with handle() method
    if (typeof handler === 'function') {
      return await handler(ctx, aiResponse);
    } else {
      return await handler.handle(ctx, aiResponse);
    }
  } catch (error) {
    logger.error(`Error executing handler for intent ${intent}:`, error);
    throw error;
  }
}

/**
 * Check if a handler exists for the given intent.
 */
export function hasHandler(intent: AIIntent): boolean {
  return intent in handlerRegistry;
}

/**
 * Get list of all registered intents.
 */
export function getRegisteredIntents(): AIIntent[] {
  return Object.keys(handlerRegistry) as AIIntent[];
}

export { handlerRegistry };
