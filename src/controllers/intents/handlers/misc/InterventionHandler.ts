/**
 * Intervention Handler
 *
 * Handles cases that require admin intervention:
 * - Urgent delivery
 * - Out of radius
 * - Custom requests
 */

import { IntentContext, IntentResult, IntentHandlerFn } from '../../types';
import { AIResponse } from '../../../../types';
import { t } from '../../../../i18n';
import { logger } from '../../../../utils/logger';
import { createIntervention } from '../../../../services/interventionService';
import { emitInterventionCreated } from '../../../../services/socketService';
import { notifyBusinessAdmin } from '../../../../services/notificationService';
import { pauseAI } from '../../../../services/sessionService';

/**
 * Requires Intervention - Generic intervention triggers
 */
export const interventionHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  // Derive reason and intervention type from analysis, fulfillment, or reply
  let reason = aiResponse.analysis?.reason as string | undefined;
  let interventionType: 'urgent_delivery' | 'out_of_radius' | 'other' = 'other';

  if (!reason && aiResponse.fulfillment) {
    // Derive reason from fulfillment data
    if (aiResponse.fulfillment.delivery_time || aiResponse.fulfillment.pickup_time) {
      const requestedTime = aiResponse.fulfillment.delivery_time || aiResponse.fulfillment.pickup_time;
      reason = `Urgent delivery requested: ${requestedTime}`;
      interventionType = 'urgent_delivery';
    } else if (aiResponse.fulfillment.fulfillment_type) {
      reason = `Fulfillment issue: ${aiResponse.fulfillment.fulfillment_type}`;
    }
  }

  if (!reason) {
    // Extract reason from AI reply (first 100 chars)
    reason = aiResponse.reply.substring(0, 100).replace(/[^\w\s]/g, ' ').trim();
  }

  logger.info(`Intervention triggered (${interventionType}): ${reason || 'Unknown reason'}`);

  // Create intervention request with correct type
  const intervention = await createIntervention(
    ctx.businessId,
    ctx.session.id,
    ctx.customer.id,
    interventionType,
    {
      message: ctx.messageText,
      reason: reason,
      requestedTime: aiResponse.fulfillment?.delivery_time || aiResponse.fulfillment?.pickup_time,
      fulfillmentType: aiResponse.fulfillment?.fulfillment_type,
      deliveryAddress: aiResponse.fulfillment?.delivery_address,
      phone: ctx.phone,
    },
    aiResponse.analysis
  );

  if (intervention) {
    // Pause AI to let admin handle it
    await pauseAI(ctx.session.id, 'System Intervention');

    // Notify admins via socket
    emitInterventionCreated(ctx.businessId, intervention);

    // Notify generic admin via notification service
    await notifyBusinessAdmin(ctx.businessId, {
      type: 'intervention_required',
      customerId: ctx.customer.id,
      phone: ctx.phone,
      message: `Admin intervention needed: ${reason || ctx.messageText}`,
    });

    // Reply to customer
    let replyMessage = t('intervention.adminWillContact', ctx.lang);
    if (!replyMessage || replyMessage.includes('intervention.')) {
      replyMessage = "An admin will review your request and contact you shortly.";
    }
    return { reply: replyMessage };
  } else {
    return { reply: t('error.generic', ctx.lang) };
  }
};
