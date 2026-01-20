/**
 * Order Status Handler
 *
 * Handles order status inquiries:
 * - Lookup by order number
 * - Find customer's active order
 */

import { IntentContext, IntentResult, IntentHandlerFn } from '../../types';
import { AIResponse } from '../../../../types';
import { t } from '../../../../i18n';
import {
  getOrderStatus,
  getCustomerActiveOrder,
  getOrderStatusMessage,
} from '../../../../services/orderService';

/**
 * Check Order Status - Customer asking about order status
 */
export const orderStatusHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  if (aiResponse.order_id) {
    // Customer provided order number - look up specific order
    const statusResult = await getOrderStatus(
      aiResponse.order_id,
      ctx.customer.id,
      ctx.businessId,
      ctx.businessTimezone
    );

    if (statusResult.success) {
      return { reply: statusResult.message };
    } else {
      return { reply: t('order.cancelFailed', ctx.lang, { message: statusResult.message }) };
    }
  } else {
    // No order number provided - try to find their active order
    const activeOrder = await getCustomerActiveOrder(ctx.customer.id, ctx.businessId);

    if (activeOrder) {
      return { reply: getOrderStatusMessage(activeOrder, ctx.lang, ctx.businessTimezone) };
    } else {
      return { reply: t('order.noActive', ctx.lang) };
    }
  }
};
