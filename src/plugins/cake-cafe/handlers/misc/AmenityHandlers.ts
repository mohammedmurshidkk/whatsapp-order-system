/**
 * Amenity Intent Handlers
 *
 * Handlers for amenity-related intents:
 * - amenity_inquiry: Customer asking about an amenity
 * - amenity_booking_request: Customer wants to book an amenity
 */

import { IntentContext, IntentResult, IntentHandlerFn, IntentHandlerRegistry } from '../types';
import { AIResponse } from '../types';
import { t } from '../../../../i18n';
import { getAmenityBySlug } from '../../services/amenityService';
import { notifyBusinessAdmin } from '../../../../services/notificationService';

/**
 * Amenity Inquiry - Customer is asking about an amenity (party hall, etc.)
 */
const amenityInquiryHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  if (!aiResponse.amenity?.amenity_slug || !ctx.business) {
    return { reply: aiResponse.reply };
  }

  const amenity = await getAmenityBySlug(ctx.business.id, aiResponse.amenity.amenity_slug);

  if (!amenity) {
    return { reply: aiResponse.reply };
  }

  // Send amenity description first
  let replyMessage = amenity.description;

  // Check for multiple images first, then fall back to single image_url
  const imagesToSend = amenity.images?.length > 0
    ? amenity.images
    : (amenity.image_url ? [amenity.image_url] : []);

  if (imagesToSend.length > 0) {
    // Send text message first
    await ctx.sendWhatsAppMessage(ctx.phone, replyMessage);

    // Send all images
    for (const imageUrl of imagesToSend) {
      await ctx.sendImage(ctx.phone, imageUrl);
    }

    // Mark that we've already sent the message
    await ctx.saveOutgoingMessage(ctx.session.id, replyMessage);
    return { reply: null, messageSaved: true };
  }

  return { reply: replyMessage };
};

/**
 * Amenity Booking Request - Customer wants to book/reserve an amenity
 */
const amenityBookingHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  if (!ctx.business) {
    return { reply: aiResponse.reply };
  }

  const amenitySlug = aiResponse.amenity?.amenity_slug || 'unknown';
  let amenityName = 'an amenity';

  if (aiResponse.amenity?.amenity_slug) {
    const amenity = await getAmenityBySlug(ctx.business.id, aiResponse.amenity.amenity_slug);
    if (amenity) {
      amenityName = amenity.name;
    }
  }

  // Create notification for admin
  await notifyBusinessAdmin(ctx.business.id, {
    type: 'amenity_booking',
    customerId: ctx.customer?.id,
    phone: ctx.phone,
    message: `Customer wants to book ${amenityName}. Phone: ${ctx.phone}`,
  });

  const replyMessage = aiResponse.reply || t('amenity.bookingRequestConfirmation', ctx.lang, { amenity: amenityName });
  return { reply: replyMessage };
};

/**
 * Export amenity handlers as a registry fragment
 */
export const amenityHandlers: IntentHandlerRegistry = {
  amenity_inquiry: amenityInquiryHandler,
  amenity_booking_request: amenityBookingHandler,
};
