/**
 * Ask Question Handler
 *
 * Handles when AI asks customer for more information.
 * Also handles fulfillment data if present.
 */

import { IntentContext, IntentResult, IntentHandlerFn } from '../../types';
import { AIResponse } from '../../../../types';
import { t } from '../../../../i18n';
import { logger } from '../../../../utils/logger';
import {
  updateSessionFulfillmentType,
  updateSessionDeliveryInfo,
  updateSessionPickupInfo,
  parseDeliveryTime,
  extractAddressAndTime,
} from '../../../../services/fulfillmentService';
import { getSessionWithItems } from '../../../../services/sessionService';
import { formatOutletsForCustomer, findOutletByCustomerInput } from '../../../../services/outletService';

/**
 * Ask Question - AI needs more information from customer
 */
export const askQuestionHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  let replyMessage = aiResponse.reply;

  // Handle fulfillment data if present
  if (aiResponse.fulfillment) {
    logger.info(`Fulfillment data in ask_question: ${JSON.stringify(aiResponse.fulfillment)}`);
    logger.info(`Current session fulfillment: type=${ctx.session.fulfillment_type}, addr=${ctx.session.delivery_address}`);

    // Set fulfillment type
    if (aiResponse.fulfillment.fulfillment_type && !ctx.session.fulfillment_type) {
      await updateSessionFulfillmentType(ctx.session.id, aiResponse.fulfillment.fulfillment_type);
      logger.info(`Fulfillment type set to: ${aiResponse.fulfillment.fulfillment_type}`);
    }

    // Handle delivery info
    if (aiResponse.fulfillment.fulfillment_type === 'delivery') {
      if (aiResponse.fulfillment.delivery_address) {
        const addressFromAI = aiResponse.fulfillment.delivery_address;

        // Skip if AI extracted coordinate format
        const isCoordinateFormat = /^(Lat|Location|Latitude|Provided Location)[\s:(]*-?\d+\.?\d*/i.test(addressFromAI) ||
          /\(Lat[\s:]*-?\d+\.?\d*.*Long[\s:]*-?\d+\.?\d*\)/i.test(addressFromAI) ||
          /Lat[\s:]*-?\d+\.?\d*.*Long[\s:]*-?\d+\.?\d*/i.test(addressFromAI);

        // Check if session already has lat/long
        const sessionData = await getSessionWithItems(ctx.session.id);
        const hasLocationAlready = sessionData?.delivery_latitude && sessionData?.delivery_longitude;

        let deliveryTime = aiResponse.fulfillment.delivery_time
          ? parseDeliveryTime(aiResponse.fulfillment.delivery_time, ctx.businessTimezone)
          : null;

        // Fallback: Try to extract time from original message
        if (!deliveryTime) {
          const extracted = extractAddressAndTime(ctx.messageText, ctx.businessTimezone);
          if (extracted.time) {
            deliveryTime = extracted.time;
            logger.info(`Extracted time from message (ask_question): ${extracted.time}`);
          }
        }

        if (isCoordinateFormat || hasLocationAlready) {
          // Skip saving AI address - preserve existing lat/long
          logger.info(`Skipping AI address in ask_question (coord format: ${isCoordinateFormat}, has location: ${hasLocationAlready})`);
          if (deliveryTime) {
            await updateSessionDeliveryInfo(ctx.session.id, { time: deliveryTime });
          }
        } else {
          await updateSessionDeliveryInfo(ctx.session.id, {
            address: addressFromAI,
            time: deliveryTime || undefined,
            notes: aiResponse.fulfillment.fulfillment_notes,
          });
          logger.info(`Delivery info saved: ${addressFromAI}, time: ${deliveryTime || 'not provided'}`);

          // If no time provided, prompt for it
          if (!deliveryTime) {
            replyMessage = t('fulfillment.gotAddress', ctx.lang, { address: addressFromAI });
          }
        }
      }
    }

    // Handle pickup info
    if (aiResponse.fulfillment.fulfillment_type === 'takeaway') {
      // Show outlets if not selected yet
      if (!aiResponse.fulfillment.pickup_outlet_id && ctx.outlets.length > 0 && !ctx.session.pickup_outlet_id) {
        const outletsList = formatOutletsForCustomer(ctx.outlets);
        replyMessage = aiResponse.reply + '\n\n' + outletsList;
      } else if (aiResponse.fulfillment.pickup_outlet_id || ctx.messageText.match(/^\d+$/)) {
        // Try to find outlet from customer input
        let selectedOutlet = findOutletByCustomerInput(ctx.messageText, ctx.outlets);

        if (!selectedOutlet && aiResponse.fulfillment.pickup_outlet_id) {
          selectedOutlet = ctx.outlets.find(o => o.id === aiResponse.fulfillment?.pickup_outlet_id) || null;
        }

        if (selectedOutlet) {
          const pickupTime = aiResponse.fulfillment.pickup_time
            ? parseDeliveryTime(aiResponse.fulfillment.pickup_time, ctx.businessTimezone)
            : null;

          await updateSessionPickupInfo(ctx.session.id, {
            outlet_id: selectedOutlet.id,
            time: pickupTime || undefined,
            notes: aiResponse.fulfillment.fulfillment_notes,
          });
          logger.info(`Pickup outlet selected: ${selectedOutlet.outlet_name}`);
        }
      }
    }
  }

  return { reply: replyMessage };
};
