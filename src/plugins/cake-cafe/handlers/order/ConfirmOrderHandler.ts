/**
 * Confirm Order Handler
 *
 * Handles final order confirmation:
 * - Validates cart has items
 * - Validates fulfillment info is complete
 * - Checks for urgent delivery
 * - Custom cake time confirmation check
 * - Creates final order
 */

import { IntentContext, IntentResult, IntentHandlerFn } from '../types';
import { AIResponse } from '../types';
import { t } from '../../../../i18n';
import { logger } from '../../../../utils/logger';
import {
  createFinalOrder,
  generateOrderSummary,
} from '../../services/orderService';
import {
  updateSessionFulfillmentType,
  updateSessionDeliveryInfo,
  updateSessionPickupInfo,
  parseDeliveryTime,
  extractAddressAndTime,
  formatDeliveryTime,
  validateOperatingHours,
} from '../../services/fulfillmentService';
import { getSessionWithItems, pauseAI } from '../../../../services/sessionService';
import { formatOutletsForCustomer, findOutletByCustomerInput } from '../../services/outletService';
import { createIntervention } from '../../services/interventionService';
import { emitInterventionCreated } from '../../../../services/socketService';
import { getAcceptedQuoteForSession } from '../../services/cakeQuoteService';

/**
 * Confirm Order - Final order confirmation
 */
export const confirmOrderHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  // Get latest session data first
  let latestSessionData = await getSessionWithItems(ctx.session.id);

  // Check if session has delivery location (address OR lat/long)
  const hasDeliveryLocation = latestSessionData?.delivery_address ||
    (latestSessionData?.delivery_latitude && latestSessionData?.delivery_longitude);

  // Track if fulfillment was just collected in THIS message
  const fulfillmentJustCollected = aiResponse.fulfillment && (
    (aiResponse.fulfillment.delivery_address && !hasDeliveryLocation) ||
    (aiResponse.fulfillment.pickup_outlet_id && !latestSessionData?.pickup_outlet_id) ||
    (aiResponse.fulfillment.delivery_time && !latestSessionData?.delivery_time) ||
    (aiResponse.fulfillment.pickup_time && !latestSessionData?.pickup_time)
  );

  // Check if fulfillment is ALREADY COMPLETE
  const fulfillmentAlreadyComplete = latestSessionData?.fulfillment_type && (
    (latestSessionData.fulfillment_type === 'delivery' && hasDeliveryLocation && latestSessionData.delivery_time) ||
    (latestSessionData.fulfillment_type === 'takeaway' && latestSessionData.pickup_outlet_id && latestSessionData.pickup_time)
  );

  // If AI provided fulfillment data with confirm_order, SAVE IT NOW
  // BUT skip if fulfillment is already complete (user is just confirming with "Yes")
  if (fulfillmentAlreadyComplete && aiResponse.fulfillment) {
    logger.info(`Fulfillment already complete - skipping AI re-sent data to prevent overwrite`);
  }

  if (aiResponse.fulfillment && !fulfillmentAlreadyComplete) {
    logger.info(`Saving fulfillment data from confirm_order: ${JSON.stringify(aiResponse.fulfillment)}`);

    // Save fulfillment type
    if (aiResponse.fulfillment.fulfillment_type) {
      await updateSessionFulfillmentType(ctx.session.id, aiResponse.fulfillment.fulfillment_type);
    }

    // Save delivery info
    if (aiResponse.fulfillment.fulfillment_type === 'delivery' && aiResponse.fulfillment.delivery_address) {
      const result = await saveDeliveryInfo(ctx, aiResponse, latestSessionData);
      if (result) return result;
    }

    // Save pickup info
    if (aiResponse.fulfillment.fulfillment_type === 'takeaway' && aiResponse.fulfillment.pickup_outlet_id) {
      const result = await savePickupInfo(ctx, aiResponse);
      if (result) return result;
    }

    // If fulfillment was just collected, show invoice for confirmation
    if (fulfillmentJustCollected) {
      logger.info(`Fulfillment just collected - showing invoice for confirmation`);
      const confirmationSummary = await generateOrderSummary(ctx.session.id, {
        includeCta: true,
        ctaMessage: t('orderSummary.reviewPromptAdd', ctx.lang),
        timezone: ctx.businessTimezone
      });
      return { reply: confirmationSummary };
    }
  }

  // NOW fetch LATEST session data (after saving fulfillment)
  const latestSession = await getSessionWithItems(ctx.session.id);

  // VALIDATION: Check if cart has items
  if (!latestSession || latestSession.items.length === 0) {
    logger.warn(`CONFIRM_ORDER attempted but cart is EMPTY! Session: ${ctx.session.id}`);
    return { reply: t('order.emptyCart', ctx.lang) };
  }

  // VALIDATION: Check if fulfillment type is set
  if (!latestSession.fulfillment_type) {
    logger.warn(`CONFIRM_ORDER attempted but no fulfillment type! Session: ${ctx.session.id}`);
    const orderSummary = await generateOrderSummary(ctx.session.id, { includeCta: false, timezone: ctx.businessTimezone });

    if (ctx.business?.supports_delivery && ctx.business?.supports_takeaway) {
      return { reply: orderSummary + '\n\n' + t('fulfillment.askTypeDirect', ctx.lang) };
    } else if (ctx.business?.supports_delivery) {
      return { reply: orderSummary + '\n\n' + t('fulfillment.askAddress', ctx.lang) };
    } else {
      let reply = orderSummary + '\n\n' + t('fulfillment.pickupPrompt', ctx.lang);
      if (ctx.outlets.length > 0) {
        reply += '\n\n' + formatOutletsForCustomer(ctx.outlets);
      }
      return { reply };
    }
  }

  // VALIDATION: For delivery, check if address/location is provided
  const hasDeliveryLocationForValidation = latestSession.delivery_address ||
    (latestSession.delivery_latitude && latestSession.delivery_longitude);
  if (latestSession.fulfillment_type === 'delivery' && !hasDeliveryLocationForValidation) {
    logger.warn(`CONFIRM_ORDER attempted but no delivery address/location! Session: ${ctx.session.id}`);
    return { reply: t('fulfillment.noAddress', ctx.lang) };
  }

  // VALIDATION: For takeaway, check if outlet is selected
  if (latestSession.fulfillment_type === 'takeaway' && !latestSession.pickup_outlet_id && ctx.outlets.length > 0) {
    logger.warn(`CONFIRM_ORDER attempted but no pickup outlet! Session: ${ctx.session.id}`);
    return { reply: t('fulfillment.noOutlet', ctx.lang, { outlets: formatOutletsForCustomer(ctx.outlets) }) };
  }

  // MANDATORY: Check if date/time is provided
  const hasDeliveryTime = latestSession.fulfillment_type === 'delivery' && latestSession.delivery_time;
  const hasPickupTime = latestSession.fulfillment_type === 'takeaway' && latestSession.pickup_time;

  if (!hasDeliveryTime && !hasPickupTime) {
    logger.warn(`CONFIRM_ORDER attempted but no date/time provided! Session: ${ctx.session.id}`);
    const timeExamples = t('time.examples', ctx.lang);
    if (latestSession.fulfillment_type === 'delivery') {
      return { reply: t('time.needTime', ctx.lang, { type: t('time.deliveryTime', ctx.lang), examples: timeExamples }) };
    } else {
      return { reply: t('time.needTime', ctx.lang, { type: t('time.pickupTime', ctx.lang), examples: timeExamples }) };
    }
  }

  // CUSTOM CAKE: Block order if time not confirmed by admin
  const customCakeQuote = await getAcceptedQuoteForSession(ctx.session.id);
  if (customCakeQuote && customCakeQuote.requested_delivery_time && !customCakeQuote.time_confirmed) {
    logger.warn(`Custom cake order blocked - waiting for admin time confirmation. Quote: ${customCakeQuote.id}`);
    return { reply: t('customCake.waitingConfirmation', ctx.lang) };
  }

  // Create the order
  try {
    logger.info(`Creating order with ${latestSession.items.length} items for session ${ctx.session.id}`);
    const order = await createFinalOrder(ctx.session.id);

    // Build confirmation message
    let confirmMsg = `${t('order.confirmed', ctx.lang)}\n\n📋 ${t('order.orderNumber', ctx.lang)}: *${order.order_number}*\n${t('order.total', ctx.lang, { amount: order.total_amount })}`;

    if (latestSession.fulfillment_type === 'delivery') {
      confirmMsg += `\n\n${t('order.delivery', ctx.lang)}`;
      if (latestSession.delivery_address) {
        confirmMsg += `\n📍 ${latestSession.delivery_address}`;
      } else if (latestSession.delivery_latitude && latestSession.delivery_longitude) {
        confirmMsg += `\n📍 Location (${latestSession.delivery_latitude.toFixed(6)}, ${latestSession.delivery_longitude.toFixed(6)})`;
      }
      if (latestSession.delivery_time) {
        confirmMsg += `\n${t('order.time', ctx.lang, { time: formatDeliveryTime(latestSession.delivery_time, ctx.businessTimezone, t('time.at', ctx.lang)) })}`;
      }
    } else if (latestSession.fulfillment_type === 'takeaway') {
      confirmMsg += `\n\n${t('order.takeaway', ctx.lang)}`;
      const selectedOutlet = ctx.outlets.find(o => o.id === latestSession.pickup_outlet_id);
      if (selectedOutlet) {
        confirmMsg += `\n📍 ${selectedOutlet.outlet_name}`;
      }
      if (latestSession.pickup_time) {
        confirmMsg += `\n${t('order.time', ctx.lang, { time: formatDeliveryTime(latestSession.pickup_time, ctx.businessTimezone, t('time.at', ctx.lang)) })}`;
      }
    }

    confirmMsg += `\n\n_${t('order.saveNumber', ctx.lang, { orderNumber: order.order_number })}_`;
    const closingMsg = ctx.business?.closing_message || 'Thank you for your order!';
    confirmMsg += `\n\n${closingMsg} 🙏`;

    return { reply: confirmMsg };
  } catch (error) {
    logger.error('Failed to create order', error);
    const supportPhone = ctx.business?.customer_support_phone;
    return {
      reply: t('order.failed', ctx.lang, {
        support: supportPhone ? t('error.contactSupport', ctx.lang, { phone: supportPhone }) : '',
      })
    };
  }
};

/**
 * Save delivery info from AI response
 */
async function saveDeliveryInfo(
  ctx: IntentContext,
  aiResponse: AIResponse,
  latestSessionData: any
): Promise<IntentResult | null> {
  const addressFromAI = aiResponse.fulfillment!.delivery_address!;

  // Skip if AI extracted coordinate format
  const isCoordinateFormat = /^(Lat|Location|Latitude|Provided Location)[\s:(]*-?\d+\.?\d*/i.test(addressFromAI) ||
    /\(Lat[\s:]*-?\d+\.?\d*.*Long[\s:]*-?\d+\.?\d*\)/i.test(addressFromAI) ||
    /Lat[\s:]*-?\d+\.?\d*.*Long[\s:]*-?\d+\.?\d*/i.test(addressFromAI);

  const hasLocationAlready = latestSessionData?.delivery_latitude && latestSessionData?.delivery_longitude;

  let deliveryTime = aiResponse.fulfillment!.delivery_time
    ? parseDeliveryTime(aiResponse.fulfillment!.delivery_time, ctx.businessTimezone)
    : null;

  // Fallback: Try to extract time from original message
  if (!deliveryTime) {
    const extracted = extractAddressAndTime(ctx.messageText, ctx.businessTimezone);
    if (extracted.time) {
      deliveryTime = extracted.time;
      logger.info(`Extracted time from message (confirm_order): ${extracted.time}`);
    }
  }

  // Validate delivery time against operating hours
  if (deliveryTime && ctx.outlets.length > 0) {
    const primaryOutlet = ctx.outlets[0];
    const validation = validateOperatingHours(deliveryTime, primaryOutlet, ctx.businessTimezone);
    if (!validation.valid) {
      const reason = t(`time.${validation.reasonKey}` as any, ctx.lang, validation.reasonValues);
      logger.warn(`Delivery time ${deliveryTime} rejected in confirm_order: ${reason}`);
      return { reply: t('time.outsideHours', ctx.lang, { reason }) };
    }
  }

  if (isCoordinateFormat || hasLocationAlready) {
    // Skip saving AI address - preserve existing lat/long
    logger.info(`Skipping AI address in confirm_order (coord format: ${isCoordinateFormat}, has location: ${hasLocationAlready})`);
    if (deliveryTime) {
      await updateSessionDeliveryInfo(ctx.session.id, { time: deliveryTime });
    }
  } else {
    await updateSessionDeliveryInfo(ctx.session.id, {
      address: addressFromAI,
      time: deliveryTime || undefined,
    });
  }

  // Check for urgent delivery
  if (deliveryTime) {
    const urgentResult = await checkUrgentDelivery(ctx, deliveryTime, latestSessionData?.delivery_address || addressFromAI || 'Location shared');
    if (urgentResult) {
      return urgentResult;
    }
  }

  return null;
}

/**
 * Save pickup info from AI response
 */
async function savePickupInfo(
  ctx: IntentContext,
  aiResponse: AIResponse
): Promise<IntentResult | null> {
  let outletId = aiResponse.fulfillment!.pickup_outlet_id!;

  // Check if it's not a valid UUID (AI returned name instead)
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(outletId);
  if (!isUUID) {
    const foundOutlet = findOutletByCustomerInput(outletId, ctx.outlets);
    if (foundOutlet) {
      outletId = foundOutlet.id;
      logger.info(`Resolved outlet name "${aiResponse.fulfillment!.pickup_outlet_id}" to ID: ${outletId}`);
    } else {
      logger.warn(`Could not find outlet: ${aiResponse.fulfillment!.pickup_outlet_id}`);
      outletId = '';
    }
  }

  if (!outletId) {
    return null;
  }

  const pickupTime = aiResponse.fulfillment!.pickup_time
    ? parseDeliveryTime(aiResponse.fulfillment!.pickup_time, ctx.businessTimezone)
    : null;

  // Validate pickup time against outlet operating hours
  if (pickupTime) {
    const selectedOutlet = ctx.outlets.find(o => o.id === outletId);
    if (selectedOutlet) {
      const validation = validateOperatingHours(pickupTime, selectedOutlet, ctx.businessTimezone);
      if (!validation.valid) {
        const reason = t(`time.${validation.reasonKey}` as any, ctx.lang, validation.reasonValues);
        logger.warn(`Pickup time ${pickupTime} rejected in confirm_order: ${reason}`);
        return { reply: t('time.outsideHours', ctx.lang, { reason }) };
      }
    }
  }

  await updateSessionPickupInfo(ctx.session.id, {
    outlet_id: outletId,
    time: pickupTime || undefined,
  });

  return null;
}

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
    logger.info(`Urgent delivery detected (confirm_order): ${deliveryTime} is ${Math.round(diffMinutes)} min away (min wait: ${minimumWaitMinutes})`);

    // Get latest session data for address
    const sessionForUrgent = await getSessionWithItems(ctx.session.id);
    const urgentAddress = sessionForUrgent?.delivery_address || deliveryAddress || 'Location shared';

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
        deliveryAddress: urgentAddress,
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
