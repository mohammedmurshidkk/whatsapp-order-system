/**
 * Collect Pickup Info Handler
 *
 * Handles takeaway outlet and time collection:
 * - Outlet selection by number or name
 * - Time parsing with operating hours validation
 * - Interactive list for outlet selection
 */

import { IntentContext, IntentResult, IntentHandlerFn } from '../../types';
import { AIResponse } from '../../../../types';
import { t } from '../../../../i18n';
import { logger } from '../../../../utils/logger';
import {
  updateSessionFulfillmentType,
  updateSessionPickupInfo,
  parseDeliveryTime,
  validateOperatingHours,
} from '../../../../services/fulfillmentService';
import { generateOrderSummary } from '../../../../services/orderService';
import { getSessionWithItems } from '../../../../services/sessionService';
import { formatOutletsForCustomer, findOutletByCustomerInput } from '../../../../services/outletService';
import { sendInteractiveListMessage } from '../../../../services/whatsapp';

/**
 * Collect Pickup Info - Collect pickup outlet and time
 */
export const collectPickupInfoHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  if (!aiResponse.fulfillment) {
    return { reply: aiResponse.reply };
  }

  // Set fulfillment type if not already set
  if (aiResponse.fulfillment.fulfillment_type && !ctx.session.fulfillment_type) {
    await updateSessionFulfillmentType(ctx.session.id, 'takeaway');
    logger.info('Fulfillment type set to: takeaway');
  }

  // Get latest session data
  const latestSessionData = await getSessionWithItems(ctx.session.id);

  // If customer selected outlet (by number or name)
  if (aiResponse.fulfillment.pickup_outlet_id || ctx.messageText.match(/^\d+$/)) {
    let selectedOutlet = null;

    // Try to find outlet from customer input
    if (ctx.messageText.match(/^\d+$/)) {
      selectedOutlet = findOutletByCustomerInput(ctx.messageText, ctx.outlets);
    }

    // Or use AI-extracted outlet ID
    if (!selectedOutlet && aiResponse.fulfillment.pickup_outlet_id) {
      selectedOutlet = ctx.outlets.find(o => o.id === aiResponse.fulfillment?.pickup_outlet_id);
    }

    if (selectedOutlet) {
      const pickupTime = aiResponse.fulfillment.pickup_time
        ? parseDeliveryTime(aiResponse.fulfillment.pickup_time, ctx.businessTimezone)
        : null;

      // Validate pickup time against outlet operating hours
      if (pickupTime) {
        const validation = validateOperatingHours(pickupTime, selectedOutlet, ctx.businessTimezone);
        if (!validation.valid) {
          const reason = t(`time.${validation.reasonKey}` as any, ctx.lang, validation.reasonValues);
          logger.warn(`Pickup time ${pickupTime} rejected: ${reason}`);
          return { reply: t('time.outsideHours', ctx.lang, { reason }) };
        }
      }

      await updateSessionPickupInfo(ctx.session.id, {
        outlet_id: selectedOutlet.id,
        time: pickupTime || undefined,
        notes: aiResponse.fulfillment.fulfillment_notes,
      });
      logger.info(`Pickup outlet selected: ${selectedOutlet.outlet_name}`);

      // If time was NOT provided, ask for it
      if (!pickupTime) {
        return { reply: t('fulfillment.askPickupTime', ctx.lang, { outlet: selectedOutlet.outlet_name }) };
      }

      // Show final invoice with pickup details and ask for confirmation
      const pickupSummary = await generateOrderSummary(ctx.session.id, {
        includeCta: true,
        ctaMessage: `\n${t('fulfillment.pickupFrom', ctx.lang)}: ${selectedOutlet.outlet_name}\n${t('orderSummary.time', ctx.lang)}: ${pickupTime}\n\n${t('orderSummary.reviewPromptAdd', ctx.lang)}`,
        timezone: ctx.businessTimezone
      });
      return { reply: pickupSummary };
    } else {
      // Show outlets list if not found
      const outletsList = formatOutletsForCustomer(ctx.outlets);
      return { reply: aiResponse.reply + '\n\n' + outletsList };
    }
  }

  // Outlet already selected, user is providing time
  if (latestSessionData?.pickup_outlet_id && !latestSessionData?.pickup_time) {
    const pickupTime = aiResponse.fulfillment.pickup_time
      ? parseDeliveryTime(aiResponse.fulfillment.pickup_time, ctx.businessTimezone)
      : parseDeliveryTime(ctx.messageText, ctx.businessTimezone);

    if (pickupTime) {
      // Validate against outlet operating hours
      const selectedOutlet = ctx.outlets.find(o => o.id === latestSessionData.pickup_outlet_id);
      if (selectedOutlet) {
        const validation = validateOperatingHours(pickupTime, selectedOutlet, ctx.businessTimezone);
        if (!validation.valid) {
          const reason = t(`time.${validation.reasonKey}` as any, ctx.lang, validation.reasonValues);
          logger.warn(`Pickup time ${pickupTime} rejected: ${reason}`);
          return { reply: t('time.outsideHours', ctx.lang, { reason }) };
        }
      }

      await updateSessionPickupInfo(ctx.session.id, {
        outlet_id: latestSessionData.pickup_outlet_id,
        time: pickupTime,
      });
      logger.info(`Pickup time saved: ${pickupTime}`);

      const outletName = selectedOutlet?.outlet_name || 'selected outlet';

      // Show final invoice with pickup details and ask for confirmation
      const pickupSummary = await generateOrderSummary(ctx.session.id, {
        includeCta: true,
        ctaMessage: `\n${t('fulfillment.pickupFrom', ctx.lang)}: ${outletName}\n${t('orderSummary.time', ctx.lang)}: ${pickupTime}\n\n${t('orderSummary.reviewPromptAdd', ctx.lang)}`,
        timezone: ctx.businessTimezone
      });
      return { reply: pickupSummary };
    } else {
      return { reply: t('time.invalidFormat', ctx.lang) };
    }
  }

  // No outlet selected yet - show interactive list
  if (!ctx.session.pickup_outlet_id && ctx.outlets.length > 0) {
    await ctx.saveOutgoingMessage(ctx.session.id, aiResponse.reply);
    await ctx.sendList(
      ctx.phone,
      t('buttons.pickupLocations', ctx.lang),
      aiResponse.reply,
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
  }

  return { reply: aiResponse.reply };
};
