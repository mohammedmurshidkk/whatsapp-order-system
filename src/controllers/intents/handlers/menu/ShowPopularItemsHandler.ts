/**
 * Show Popular Items Handler
 *
 * Displays top-selling/trending items to customer
 */

import { IntentContext, IntentResult, IntentHandlerFn } from '../../types';
import { AIResponse } from '../../../../types';
import { getPopularItemsForAI } from '../../../../services/popularItemsService';

/**
 * Show Popular Items - Display trending items to customer
 */
export const showPopularItemsHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  if (!ctx.business?.id) {
    return { reply: "I can't fetch popular items right now. Please ask for the menu." };
  }

  const popularItems = await getPopularItemsForAI(ctx.business.id);

  if (popularItems.length === 0) {
    return { reply: "We're still gathering our top sellers! You can ask for the menu to see all our items." };
  }

  let replyMessage = `⭐ Here are our most popular items:\n\n`;

  replyMessage += popularItems.map((item: any, i: number) => {
    let itemText = `${i + 1}. *${item.item_name}*`;

    // Add price from sizes or base_price (getPopularItemsForAI structure)
    if (item.sizes && item.sizes.length > 0) {
      const sizesPrices = item.sizes.map((s: any) => `${s.name}: ₹${s.price}`).join(', ');
      itemText += ` - ${sizesPrices}`;
    } else if (item.base_price) {
      itemText += ` - ₹${item.base_price}`;
    }

    // Add description
    if (item.description) {
      itemText += `\n   ${item.description}`;
    }

    return itemText;
  }).join('\n\n');

  replyMessage += `\n\nWhat would you like to order?`;

  // Send images for all popular items that have them
  const itemsWithImages = popularItems.filter((item: any) => item.image_url);
  for (const item of itemsWithImages) {
    let priceText = '';
    if (item.sizes && item.sizes.length > 0) {
      priceText = item.sizes.map((s: any) => `${s.name}: ₹${s.price}`).join(', ');
    } else if (item.base_price) {
      priceText = `₹${item.base_price}`;
    }
    const caption = `${item.item_name}${priceText ? ` - ${priceText}` : ''}`;
    await ctx.sendImage(ctx.phone, item.image_url, caption);
  }

  return { reply: replyMessage };
};
