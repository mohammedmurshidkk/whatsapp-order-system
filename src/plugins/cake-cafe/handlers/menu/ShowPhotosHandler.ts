/**
 * Show Photos Handler
 *
 * Handles photo requests:
 * - Specific item photos
 * - Category photos (with pagination)
 */

import { IntentContext, IntentResult, IntentHandlerFn } from '../types';
import { AIResponse } from '../types';
import { logger } from '../../../../utils/logger';
import {
  getMenuItems,
  getMenuCategories,
  getMenuItemsByCategory,
} from '../../services/menuService';
import { saveOutgoingMessage } from '../../../../services/messageService';

/**
 * Show Photos - Display menu item photos to customer
 */
export const showPhotosHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  if (!ctx.business) {
    return { reply: ctx.lang === 'ml'
      ? 'ക്ഷമിക്കണം, ഫോട്ടോകൾ ലഭ്യമല്ല.'
      : "Sorry, photos aren't available right now."
    };
  }

  const photoRequest = aiResponse.photoRequest;

  // Case 1: Specific item photo request
  if (photoRequest?.item_name) {
    const menuItems = await getMenuItems(ctx.business.id);
    const requestedName = photoRequest.item_name.toLowerCase().trim();

    // 1. Exact match first
    let matchedItem = menuItems.find(
      item => item.name.toLowerCase() === requestedName
    );

    // 2. If no exact match, find best partial match
    if (!matchedItem) {
      const partialMatches = menuItems.filter(
        item => item.name.toLowerCase().includes(requestedName) ||
          requestedName.includes(item.name.toLowerCase())
      );
      if (partialMatches.length > 0) {
        matchedItem = partialMatches.sort((a, b) => b.name.length - a.name.length)[0];
      }
    }

    if (matchedItem && matchedItem.image_url) {
      // Build price string
      let priceStr = '';
      if (matchedItem.sizes && matchedItem.sizes.length > 0) {
        priceStr = matchedItem.sizes.map(s => `${s.name}: ₹${s.price}`).join(' | ');
      } else if (matchedItem.price) {
        priceStr = `₹${matchedItem.price}`;
      }

      const caption = `${matchedItem.name}\n💰 ${priceStr}\n\nReply with the name to order!`;
      await ctx.sendImage(ctx.phone, matchedItem.image_url, caption);
      await saveOutgoingMessage(ctx.session.id, caption, {
        messageType: 'image',
        mediaUrl: matchedItem.image_url,
        mediaMimeType: 'image/jpeg',
        mediaCaption: caption
      });
      return { reply: null, messageSaved: true };
    } else if (matchedItem && !matchedItem.image_url) {
      return {
        reply: ctx.lang === 'ml'
          ? `ക്ഷമിക്കണം, ${matchedItem.name}-ന്റെ ഫോട്ടോ ഇപ്പോൾ ലഭ്യമല്ല.`
          : `Sorry, no photo available for ${matchedItem.name} at the moment.`
      };
    } else {
      return {
        reply: ctx.lang === 'ml'
          ? `ക്ഷമിക്കണം, "${photoRequest.item_name}" കണ്ടെത്തിയില്ല.`
          : `Sorry, couldn't find "${photoRequest.item_name}" in our menu.`
      };
    }
  }

  // Case 2: Category photo request
  if (photoRequest?.category) {
    const requestedCategory = photoRequest.category;
    const categories = await getMenuCategories(ctx.business.id);
    const matchedCategory = categories.find(
      c => c.name.toLowerCase() === requestedCategory.toLowerCase()
    );

    if (matchedCategory) {
      const categoryItems = await getMenuItemsByCategory(ctx.business.id, matchedCategory.id);
      const itemsWithImages = categoryItems.filter(item => item.image_url);

      if (itemsWithImages.length === 0) {
        return {
          reply: ctx.lang === 'ml'
            ? `ക്ഷമിക്കണം, ${matchedCategory.name} വിഭാഗത്തിൽ ഇപ്പോൾ ഫോട്ടോകൾ ലഭ്യമല്ല.`
            : `Sorry, no photos available for ${matchedCategory.name} at the moment.`
        };
      }

      const MAX_PHOTOS = 5;
      const photosToSend = itemsWithImages.slice(0, MAX_PHOTOS);
      const hasMore = itemsWithImages.length > MAX_PHOTOS;

      // Send intro message
      const introMsg = ctx.lang === 'ml'
        ? `ഇതാ ഞങ്ങളുടെ ${matchedCategory.name} ഫോട്ടോകൾ:`
        : `Here are our ${matchedCategory.name} photos:`;
      await ctx.sendWhatsAppMessage(ctx.phone, introMsg);

      // Send each image with caption
      for (const item of photosToSend) {
        let priceStr = '';
        if (item.sizes && item.sizes.length > 0) {
          priceStr = item.sizes.map(s => `${s.name}: ₹${s.price}`).join(' | ');
        } else if (item.price) {
          priceStr = `₹${item.price}`;
        }

        const caption = `${item.name}\n💰 ${priceStr}\n\nReply with the name to order!`;
        await ctx.sendImage(ctx.phone, item.image_url!, caption);
        await saveOutgoingMessage(ctx.session.id, caption, {
          messageType: 'image',
          mediaUrl: item.image_url,
          mediaMimeType: 'image/jpeg',
          mediaCaption: caption
        });
      }

      // If more items available, ask if they want to see more
      if (hasMore) {
        const moreMsg = ctx.lang === 'ml'
          ? `${itemsWithImages.length - MAX_PHOTOS} കൂടി ഐറ്റങ്ങൾ ഉണ്ട്. "കൂടുതൽ കാണിക്കുക" എന്ന് പറയുക.`
          : `${itemsWithImages.length - MAX_PHOTOS} more items available. Say "show more" to see them.`;
        await ctx.sendWhatsAppMessage(ctx.phone, moreMsg);
      }

      return { reply: null, messageSaved: true };
    } else {
      const availableCategories = categories.map(c => c.name).join(', ');
      return {
        reply: ctx.lang === 'ml'
          ? `ക്ഷമിക്കണം, "${requestedCategory}" കാറ്റഗറി കണ്ടെത്തിയില്ല. ലഭ്യമായവ: ${availableCategories}`
          : `Sorry, couldn't find "${requestedCategory}" category. Available: ${availableCategories}`
      };
    }
  }

  // No category or item specified, ask which category
  const categories = await getMenuCategories(ctx.business.id);
  const categoryNames = categories.map(c => c.name).join(', ');
  return {
    reply: ctx.lang === 'ml'
      ? `ഏത് കാറ്റഗറിയുടെ ഫോട്ടോകൾ കാണണം? ലഭ്യമായവ: ${categoryNames}`
      : `Which category photos would you like to see? Available: ${categoryNames}`
  };
};
