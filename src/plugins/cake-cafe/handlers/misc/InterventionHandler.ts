/**
 * Intervention Handler
 *
 * Handles cases that require admin intervention:
 * - Urgent delivery
 * - Out of radius
 * - Custom requests
 */

import { IntentContext, IntentResult, IntentHandlerFn } from '../types';
import { AIResponse } from '../types';
import { t } from '../../../../i18n';
import { logger } from '../../../../utils/logger';
import { createIntervention } from '../../services/interventionService';
import { emitInterventionCreated } from '../../../../services/socketService';
import { notifyBusinessAdmin } from '../../../../services/notificationService';
import { pauseAI } from '../../../../services/sessionService';
import { parseDeliveryTime, updateSessionDeliveryInfo, updateSessionPickupInfo } from '../../services/fulfillmentService';

/**
 * Requires Intervention - Generic intervention triggers
 */
export const interventionHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  // Derive reason and intervention type from analysis, fulfillment, or reply
  let reason = aiResponse.analysis?.reason as string | undefined;
  let interventionType: 'urgent_delivery' | 'out_of_radius' | 'other' = 'other';

  // Parse time from AI response to ISO format
  let parsedDeliveryTime: string | null = null;
  let parsedPickupTime: string | null = null;
  const rawDeliveryTime = aiResponse.fulfillment?.delivery_time;
  const rawPickupTime = aiResponse.fulfillment?.pickup_time;

  if (rawDeliveryTime) {
    parsedDeliveryTime = parseDeliveryTime(rawDeliveryTime, ctx.businessTimezone);
    logger.info(`Parsed delivery time: "${rawDeliveryTime}" -> ${parsedDeliveryTime}`);
  }
  if (rawPickupTime) {
    parsedPickupTime = parseDeliveryTime(rawPickupTime, ctx.businessTimezone);
    logger.info(`Parsed pickup time: "${rawPickupTime}" -> ${parsedPickupTime}`);
  }

  if (!reason && aiResponse.fulfillment) {
    // Derive reason from fulfillment data
    if (rawDeliveryTime || rawPickupTime) {
      const requestedTime = rawDeliveryTime || rawPickupTime;
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

  // Update session with parsed fulfillment data before creating intervention
  if (aiResponse.fulfillment?.fulfillment_type === 'delivery') {
    await updateSessionDeliveryInfo(ctx.session.id, {
      address: aiResponse.fulfillment.delivery_address || undefined,
      time: parsedDeliveryTime || undefined,
    });
    logger.info(`Session updated with delivery info: address=${aiResponse.fulfillment.delivery_address}, time=${parsedDeliveryTime}`);
  } else if (aiResponse.fulfillment?.fulfillment_type === 'takeaway' && aiResponse.fulfillment.pickup_outlet_id) {
    await updateSessionPickupInfo(ctx.session.id, {
      outlet_id: aiResponse.fulfillment.pickup_outlet_id,
      time: parsedPickupTime || undefined,
    });
    logger.info(`Session updated with pickup info: outlet=${aiResponse.fulfillment.pickup_outlet_id}, time=${parsedPickupTime}`);
  }

  // Create intervention request with parsed time (ISO format)
  const intervention = await createIntervention(
    ctx.businessId,
    ctx.session.id,
    ctx.customer.id,
    interventionType,
    {
      message: ctx.messageText,
      reason: reason,
      requestedTime: parsedDeliveryTime || parsedPickupTime || rawDeliveryTime || rawPickupTime,
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
