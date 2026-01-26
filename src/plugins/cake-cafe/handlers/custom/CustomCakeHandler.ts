/**
 * Custom Cake Handler
 *
 * Handles custom cake inquiries:
 * - Set context for image upload
 * - Extract weight/flavor from message
 * - Show available flavors
 */

import { IntentContext, IntentResult, IntentHandlerFn } from '../types';
import { AIResponse } from '../types';
import { t } from '../../../../i18n';
import { logger } from '../../../../utils/logger';
import { updateSessionCustomCakeContext } from '../../../../services/sessionService';
import { getFullPricingConfig } from '../../services/cakePricingService';

/**
 * Format available flavors from pricing config for display
 */
async function formatAvailableFlavors(businessId: string, lang: 'en' | 'ml'): Promise<string> {
  try {
    const pricingConfig = await getFullPricingConfig(businessId);
    if (!pricingConfig.flavorsGrouped || pricingConfig.flavorsGrouped.length === 0) {
      return '';
    }

    const flavorNames = pricingConfig.flavorsGrouped.map((f: any) => f.flavor_name);
    const prefix = lang === 'ml' ? '\n\nലഭ്യമായ ഫ്ലേവറുകൾ: ' : '\n\nAvailable flavors: ';
    return prefix + flavorNames.join(', ');
  } catch (error) {
    logger.warn('Failed to get flavors for formatting', error);
    return '';
  }
}

/**
 * Custom Cake Inquiry - Customer asking about custom/personalized cake design
 */
export const customCakeHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  if (!ctx.business || !(ctx.business as any).custom_cake_enabled) {
    // Custom cakes not enabled
    const supportPhone = ctx.business?.customer_support_phone;
    return {
      reply: supportPhone
        ? t('customCake.contactSupport', ctx.lang, { phone: supportPhone })
        : "Sorry, we don't do custom cakes at the moment."
    };
  }

  logger.info('Custom cake inquiry - setting up for image upload');

  // Extract weight/flavor if present in message
  const extractedWeight = ctx.messageText.match(/(\d+(?:\.\d+)?\s*(?:kg|g|lb|pound)s?)/i)?.[1];
  const extractedFlavor = ctx.messageText.match(/(chocolate|vanilla|strawberry|red velvet|butterscotch|black forest|truffle)/i)?.[0];

  // Set context flag - don't create intervention yet, wait for image
  await updateSessionCustomCakeContext(ctx.session.id, {
    awaiting_image: true,
    inquiry_type: 'text_first',
    weight: extractedWeight,
    flavor: extractedFlavor,
  });

  // Get available flavors to show
  const availableFlavorsText = await formatAvailableFlavors(ctx.business.id, ctx.lang);

  // Ask for image with flavor list
  let replyMessage = t('customCake.askForImage', ctx.lang, { flavors: availableFlavorsText });
  if (!replyMessage || replyMessage.includes('customCake.')) {
    replyMessage = `Yes! We do custom cakes! 🎂\n\nPlease share a photo of the design you'd like.\n\nAlso let us know:\n• Weight (e.g., 1kg, 2kg)\n• Flavor${availableFlavorsText}`;
  }

  return { reply: replyMessage };
};
