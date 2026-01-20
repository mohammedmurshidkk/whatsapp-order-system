/**
 * Modify Order Handler
 *
 * Handles order modifications:
 * - Change item quantity
 * - Remove items
 * - Add items if they don't exist
 */

import { IntentContext, IntentResult, IntentHandlerFn } from '../../types';
import { AIResponse } from '../../../../types';
import { t } from '../../../../i18n';
import { logger } from '../../../../utils/logger';
import {
  updateSessionItemQuantity,
  removeSessionItem,
  saveOrderItem,
  generateOrderSummary,
} from '../../../../services/orderService';

/**
 * Modify Order - Customer wants to modify their order
 */
export const modifyOrderHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  if (aiResponse.item && aiResponse.item.name) {
    if (aiResponse.item.quantity === 0) {
      // Remove item
      await removeSessionItem(ctx.session.id, aiResponse.item.name, aiResponse.item.size_or_weight);
      logger.info(`Item removed: ${aiResponse.item.name}`);
    } else {
      // Check if item exists in session
      const itemExists = ctx.existingItems.some(item =>
        item.item_name.toLowerCase().includes(aiResponse.item!.name.toLowerCase()) ||
        aiResponse.item!.name.toLowerCase().includes(item.item_name.toLowerCase())
      );

      if (itemExists) {
        // Update quantity
        await updateSessionItemQuantity(
          ctx.session.id,
          aiResponse.item.name,
          aiResponse.item.quantity,
          aiResponse.item.size_or_weight
        );
        logger.info(`Item updated: ${aiResponse.item.name} x${aiResponse.item.quantity}`);
      } else {
        // Add as new item
        await saveOrderItem(ctx.session.id, aiResponse.item, ctx.businessId);
        logger.info(`Item added: ${aiResponse.item.name}`);
      }
    }
  }

  // Always show updated summary after modification
  const modifiedSummary = await generateOrderSummary(ctx.session.id, {
    includeCta: true,
    ctaMessage: t('orderSummary.confirmItems', ctx.lang),
    timezone: ctx.businessTimezone,
  });

  return { reply: aiResponse.reply + '\n\n' + modifiedSummary };
};
