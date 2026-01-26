/**
 * Simple Intent Handlers
 *
 * Low-complexity handlers that mostly return AI's reply or simple messages.
 * Grouped together to reduce file count.
 */

import { IntentContext, IntentResult, IntentHandlerFn, IntentHandlerRegistry } from '@/plugins/cake-cafe/handlers/types';
import { AIResponse } from '@/types';
import { t } from '../../../../i18n';
import { logger } from '../../../../utils/logger';
import { cancelOrderById } from '../../services/orderService';
import { getSessionWithItems } from '../../../../services/sessionService';
import { formatOutletsForCustomer } from '../../services/outletService';

/**
 * Cancel - Customer wants to cancel current session
 */
const cancelHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  return { reply: t('order.cancelled', ctx.lang) };
};

/**
 * Decline Addon - Customer declined add-on suggestions
 */
const declineAddonHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  logger.info('Customer declined add-ons');
  return { reply: aiResponse.reply };
};

/**
 * Continue Ordering - Ask for more items after add-ons handled
 */
const continueOrderingHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  logger.info('Continuing with ordering');
  // AI's reply should ask "Anything else?"
  return { reply: aiResponse.reply };
};

/**
 * Conversation Ended - Farewell after order
 */
const conversationEndedHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  // Just send the farewell message, no need to ask more questions
  return { reply: aiResponse.reply };
};

/**
 * Smalltalk - General conversation
 */
const smalltalkHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  // Use AI's reply as is
  return { reply: aiResponse.reply };
};

/**
 * Confirm Items - Legacy support, treat same as ready_for_checkout
 */
const confirmItemsHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  const itemsSession = await getSessionWithItems(ctx.session.id);

  if (!itemsSession || itemsSession.items.length === 0) {
    logger.warn(`CONFIRM_ITEMS but cart is EMPTY! Session: ${ctx.session.id}`);
    return { reply: t('cart.empty', ctx.lang) };
  }

  // Ask for delivery or takeaway
  let replyMessage: string;

  if (ctx.business?.supports_delivery && ctx.business?.supports_takeaway) {
    replyMessage = t('fulfillment.askTypeDirect', ctx.lang);
  } else if (ctx.business?.supports_delivery) {
    replyMessage = t('fulfillment.askAddress', ctx.lang);
  } else {
    replyMessage = t('fulfillment.pickupPrompt', ctx.lang);
    if (ctx.outlets.length > 0) {
      replyMessage += '\n\n' + formatOutletsForCustomer(ctx.outlets);
    }
  }

  return { reply: replyMessage };
};

/**
 * Ask Fulfillment Type - Ask customer for delivery or takeaway
 */
const askFulfillmentTypeHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  let replyMessage: string;

  if (ctx.business?.supports_delivery && ctx.business?.supports_takeaway) {
    replyMessage = aiResponse.reply || t('fulfillment.askType', ctx.lang);
  } else if (ctx.business?.supports_delivery) {
    replyMessage = t('fulfillment.offerDelivery', ctx.lang);
  } else {
    replyMessage = t('fulfillment.pickupPrompt', ctx.lang);
  }

  return { reply: replyMessage };
};

/**
 * Cancel Existing Order - Cancel a previously confirmed order
 */
const cancelExistingOrderHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  if (aiResponse.order_id) {
    const cancelResult = await cancelOrderById(
      aiResponse.order_id,
      ctx.customer.id,
      ctx.businessId
    );

    if (cancelResult.success) {
      return { reply: t('order.cancelledSuccess', ctx.lang, { message: cancelResult.message }) };
    } else {
      return { reply: t('order.cancelFailed', ctx.lang, { message: cancelResult.message }) };
    }
  } else {
    return { reply: t('order.provideOrderNumber', ctx.lang) };
  }
};

/**
 * Item Not Available - AI couldn't find item on menu
 * Note: The custom cake fallback is handled in webhookController before this
 */
const itemNotAvailableHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  // AI's reply should already explain item not found and suggest alternatives
  return { reply: aiResponse.reply };
};

/**
 * Export all simple handlers as a registry fragment
 */
export const simpleHandlers: IntentHandlerRegistry = {
  cancel: async (ctx: IntentContext, aiResponse: AIResponse) => cancelHandler(ctx, aiResponse),
  decline_addon: async (ctx: IntentContext, aiResponse: AIResponse) => declineAddonHandler(ctx, aiResponse),
  continue_ordering: async (ctx: IntentContext, aiResponse: AIResponse) => continueOrderingHandler(ctx, aiResponse),
  conversation_ended: async (ctx: IntentContext, aiResponse: AIResponse) => conversationEndedHandler(ctx, aiResponse),
  smalltalk: async (ctx: IntentContext, aiResponse: AIResponse) => smalltalkHandler(ctx, aiResponse),
  confirm_items: async (ctx: IntentContext, aiResponse: AIResponse) => confirmItemsHandler(ctx, aiResponse),
  ask_fulfillment_type: async (ctx: IntentContext, aiResponse: AIResponse) => askFulfillmentTypeHandler(ctx, aiResponse),
  cancel_existing_order: async (ctx: IntentContext, aiResponse: AIResponse) => cancelExistingOrderHandler(ctx, aiResponse),
  item_not_available: async (ctx: IntentContext, aiResponse: AIResponse) => itemNotAvailableHandler(ctx, aiResponse),
};
