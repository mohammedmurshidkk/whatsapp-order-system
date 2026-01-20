/**
 * Ready For Checkout Handler
 *
 * Handles when customer indicates they're done ordering:
 * - Validates cart has items
 * - If fulfillment already collected, shows final summary
 * - Otherwise asks for delivery/takeaway choice
 */

import { IntentContext, IntentResult, IntentHandlerFn } from '../../types';
import { AIResponse } from '../../../../types';
import { t } from '../../../../i18n';
import { logger } from '../../../../utils/logger';
import { generateOrderSummary } from '../../../../services/orderService';
import { getSessionWithItems } from '../../../../services/sessionService';
import { updateSessionFulfillmentType } from '../../../../services/fulfillmentService';

/**
 * Ready For Checkout - Customer says "that's all" or similar
 */
export const readyForCheckoutHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  // Validate cart first
  const checkoutSession = await getSessionWithItems(ctx.session.id);
  if (!checkoutSession || checkoutSession.items.length === 0) {
    logger.warn(`READY_FOR_CHECKOUT but cart is EMPTY! Session: ${ctx.session.id}`);
    return { reply: t('cart.empty', ctx.lang) };
  }

  // Check if fulfillment info is already complete
  const hasFulfillmentInfo = ctx.session.fulfillment_type && (
    (ctx.session.fulfillment_type === 'delivery' && ctx.session.delivery_address) ||
    (ctx.session.fulfillment_type === 'takeaway' && ctx.session.pickup_outlet_id)
  );

  if (hasFulfillmentInfo) {
    // Fulfillment already collected - show final summary and ask for confirmation
    const finalSummary = await generateOrderSummary(ctx.session.id, {
      includeCta: true,
      timezone: ctx.businessTimezone
    });
    return { reply: finalSummary + '\n\n' + t('order.confirmPrompt', ctx.lang) };
  }

  // Show summary and ask for delivery/takeaway
  const summary = await generateOrderSummary(ctx.session.id, {
    includeCta: false,
    timezone: ctx.businessTimezone
  });

  if (ctx.business?.supports_delivery && ctx.business?.supports_takeaway) {
    // Use interactive buttons for delivery/takeaway choice
    const askFulfillment = summary + '\n\n' + t('fulfillment.askType', ctx.lang);
    await ctx.saveOutgoingMessage(ctx.session.id, askFulfillment);
    await ctx.sendButtons(ctx.phone, askFulfillment, [
      { id: 'delivery', title: t('fulfillment.deliveryBtn', ctx.lang) },
      { id: 'takeaway', title: t('fulfillment.takeawayBtn', ctx.lang) },
    ]);
    return { reply: null, messageSaved: true };
  } else if (ctx.business?.supports_delivery) {
    return { reply: summary + '\n\n' + t('fulfillment.deliveryPrompt', ctx.lang) };
  } else {
    // Takeaway only - Use interactive list for outlet selection
    if (ctx.outlets.length > 0) {
      await updateSessionFulfillmentType(ctx.session.id, 'takeaway');
      const pickupPrompt = summary + '\n\n' + t('fulfillment.pickupPrompt', ctx.lang);
      await ctx.saveOutgoingMessage(ctx.session.id, pickupPrompt);
      await ctx.sendList(
        ctx.phone,
        t('buttons.pickupLocations', ctx.lang),
        pickupPrompt,
        t('buttons.chooseLocation', ctx.lang),
        [{
          title: t('buttons.availableOutlets', ctx.lang),
          rows: ctx.outlets.map(o => ({
            id: o.id,
            title: o.outlet_name,
            description: o.address?.substring(0, 72),
          })),
        }]
      );
      return { reply: null, messageSaved: true };
    } else {
      return { reply: summary + '\n\n' + t('fulfillment.askPickupTimeGeneric', ctx.lang) };
    }
  }
};
