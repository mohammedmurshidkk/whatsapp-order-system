/**
 * Collect Delivery Info Handler
 *
 * Handles delivery address and time collection:
 * - Address parsing and validation
 * - Time parsing with timezone awareness
 * - Urgent delivery detection
 * - Distance-based delivery fee calculation
 */

import { IntentContext, IntentResult, IntentHandlerFn } from '../../types';
import { AIResponse } from '../../../../types';
import { t } from '../../../../i18n';
import { logger } from '../../../../utils/logger';
import {
  updateSessionFulfillmentType,
  updateSessionDeliveryInfo,
  parseDeliveryTime,
  extractAddressAndTime,
} from '../../../../services/fulfillmentService';
import { generateOrderSummary } from '../../../../services/orderService';
import { getSessionWithItems, pauseAI } from '../../../../services/sessionService';
import { createIntervention } from '../../../../services/interventionService';
import { emitInterventionCreated } from '../../../../services/socketService';

/**
 * Collect Delivery Info - Collect delivery address and time
 */
export const collectDeliveryInfoHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  if (!aiResponse.fulfillment) {
    return { reply: aiResponse.reply };
  }

  // Set fulfillment type if not already set
  if (aiResponse.fulfillment.fulfillment_type && !ctx.session.fulfillment_type) {
    await updateSessionFulfillmentType(ctx.session.id, 'delivery');
    logger.info('Fulfillment type set to: delivery');
  }

  // Save delivery address if provided
  if (aiResponse.fulfillment.delivery_address) {
    const addressFromAI = aiResponse.fulfillment.delivery_address;

    // Skip if AI extracted coordinate format (not a real address)
    const isCoordinateFormat = /^(Lat|Location|Latitude|Provided Location)[\s:(]*-?\d+\.?\d*/i.test(addressFromAI) ||
      /\(Lat[\s:]*-?\d+\.?\d*.*Long[\s:]*-?\d+\.?\d*\)/i.test(addressFromAI) ||
      /Lat[\s:]*-?\d+\.?\d*.*Long[\s:]*-?\d+\.?\d*/i.test(addressFromAI);

    // Check if session already has lat/long (location was shared via WhatsApp)
    const sessionData = await getSessionWithItems(ctx.session.id);
    const hasLocationAlready = sessionData?.delivery_latitude && sessionData?.delivery_longitude;

    if (isCoordinateFormat) {
      logger.info(`Skipping coordinate format address from AI: ${addressFromAI}`);
      // Still try to save time if provided
      let deliveryTime = aiResponse.fulfillment.delivery_time
        ? parseDeliveryTime(aiResponse.fulfillment.delivery_time, ctx.businessTimezone)
        : null;
      if (deliveryTime) {
        await updateSessionDeliveryInfo(ctx.session.id, { time: deliveryTime });
        logger.info(`Delivery time saved (skipped coord address): ${deliveryTime}`);
      }
      return { reply: aiResponse.reply };
    }

    if (hasLocationAlready) {
      // Has lat/long from WhatsApp location - preserve it, only update time
      logger.info(`Session already has location coordinates - preserving existing data`);
      let deliveryTime = aiResponse.fulfillment.delivery_time
        ? parseDeliveryTime(aiResponse.fulfillment.delivery_time, ctx.businessTimezone)
        : null;

      if (!deliveryTime) {
        const extracted = extractAddressAndTime(ctx.messageText, ctx.businessTimezone);
        if (extracted.time) {
          deliveryTime = extracted.time;
        }
      }

      if (deliveryTime && !sessionData?.delivery_time) {
        // Check for urgent delivery
        const urgentResult = await checkUrgentDelivery(
          ctx,
          deliveryTime,
          sessionData?.delivery_address || 'Location shared'
        );
        if (urgentResult) {
          return urgentResult;
        }

        await updateSessionDeliveryInfo(ctx.session.id, { time: deliveryTime });
        logger.info(`Delivery time saved (preserving location): ${deliveryTime}`);

        // Show final invoice
        const deliverySummary = await generateOrderSummary(ctx.session.id, {
          includeCta: true,
          ctaMessage: t('orderSummary.reviewPromptAdd', ctx.lang),
          timezone: ctx.businessTimezone
        });
        return { reply: deliverySummary };
      } else if (!sessionData?.delivery_time) {
        // Need to ask for time
        return { reply: t('fulfillment.locationSavedThenAskTime', ctx.lang) };
      }
    } else {
      // No existing location - save the AI-extracted address
      let deliveryTime = aiResponse.fulfillment.delivery_time
        ? parseDeliveryTime(aiResponse.fulfillment.delivery_time, ctx.businessTimezone)
        : null;

      // Fallback: Try to extract time from the original message
      if (!deliveryTime) {
        const extracted = extractAddressAndTime(ctx.messageText, ctx.businessTimezone);
        if (extracted.time) {
          deliveryTime = extracted.time;
        }
      }

      await updateSessionDeliveryInfo(ctx.session.id, {
        address: addressFromAI,
        time: deliveryTime || undefined,
        notes: aiResponse.fulfillment.fulfillment_notes,
      });
      logger.info(`Delivery info saved: ${addressFromAI}, time: ${deliveryTime || 'not provided'}`);

      // Check if time was provided - if not, ask for it
      if (!deliveryTime) {
        return { reply: t('fulfillment.gotAddress', ctx.lang, { address: addressFromAI }) };
      }

      // Check for urgent delivery
      const urgentResult = await checkUrgentDelivery(ctx, deliveryTime, addressFromAI);
      if (urgentResult) {
        return urgentResult;
      }

      // Show final invoice with delivery details
      const deliverySummary = await generateOrderSummary(ctx.session.id, {
        includeCta: true,
        ctaMessage: t('orderSummary.reviewPromptAdd', ctx.lang),
        timezone: ctx.businessTimezone
      });
      return { reply: deliverySummary };
    }
  }

  return { reply: aiResponse.reply };
};

/**
 * Check if delivery is urgent and create intervention if needed
 */
async function checkUrgentDelivery(
  ctx: IntentContext,
  deliveryTime: string,
  deliveryAddress: string
): Promise<IntentResult | null> {
  const minimumWaitMinutes = (ctx.business as any)?.minimum_wait_minutes;

  if (!minimumWaitMinutes || minimumWaitMinutes <= 0) {
    return null;
  }

  const requestedDate = new Date(deliveryTime);
  const now = new Date();
  const diffMinutes = (requestedDate.getTime() - now.getTime()) / (1000 * 60);

  if (diffMinutes > 0 && diffMinutes < minimumWaitMinutes) {
    logger.info(`Urgent delivery detected: ${deliveryTime} is ${Math.round(diffMinutes)} min away (min wait: ${minimumWaitMinutes})`);

    // Create urgent_delivery intervention
    const urgentIntervention = await createIntervention(
      ctx.businessId,
      ctx.session.id,
      ctx.customer.id,
      'urgent_delivery',
      {
        requestedTime: deliveryTime,
        fulfillmentType: 'delivery',
        minimumWaitMinutes,
        minutesUntilRequested: Math.round(diffMinutes),
        deliveryAddress,
        phone: ctx.phone,
      }
    );

    if (urgentIntervention) {
      await pauseAI(ctx.session.id, 'Urgent order - awaiting admin confirmation');
      emitInterventionCreated(ctx.businessId, urgentIntervention);

      const formattedTime = new Date(deliveryTime).toLocaleString('en-IN', {
        timeZone: ctx.businessTimezone,
        dateStyle: 'medium',
        timeStyle: 'short',
      });
      const typeLabel = t('fulfillment.deliveryBtn', ctx.lang);
      return { reply: t('urgentOrder.waitingConfirmation', ctx.lang, { type: typeLabel, time: formattedTime }) };
    }
  }

  return null;
}
