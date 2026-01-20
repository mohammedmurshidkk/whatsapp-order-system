/**
 * Add Item Handler
 *
 * Handles adding items to cart:
 * - Single item addition
 * - Multiple items with individual notes
 * - Duplicate prevention
 * - Custom text prompt for categories (e.g., "What to write on cake?")
 * - Auto-suggested add-ons
 */

import { IntentContext, IntentResult, IntentHandlerFn } from '../../types';
import { AIResponse, SessionItem } from '../../../../types';
import { t } from '../../../../i18n';
import { logger } from '../../../../utils/logger';
import { saveOrderItem } from '../../../../services/orderService';
import {
  setLastAddedItem,
  setPendingCustomText,
  setPendingAddonSelection,
} from '../../../../services/sessionService';
import {
  getAutoSuggestedAddons,
  formatAddonsForCustomer,
} from '../../../../services/addonService';

/**
 * Check if item is already in cart (duplicate prevention)
 */
function isItemDuplicate(
  existingItems: SessionItem[],
  itemName: string,
  sizeOrWeight?: string
): boolean {
  const normalizedName = itemName.toLowerCase().trim();

  return existingItems.some(item => {
    const existingName = item.item_name.toLowerCase().trim();
    const nameMatch = existingName.includes(normalizedName) || normalizedName.includes(existingName);

    // If both have size/weight, they must match
    if (sizeOrWeight && item.size_or_weight) {
      const sizeMatch = item.size_or_weight.toLowerCase() === sizeOrWeight.toLowerCase();
      return nameMatch && sizeMatch;
    }

    // If neither has size/weight, just check name
    if (!sizeOrWeight && !item.size_or_weight) {
      return nameMatch;
    }

    // One has size, other doesn't - not a duplicate
    return false;
  });
}

/**
 * Add Item - Customer wants to add item(s) to cart
 */
export const addItemHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  let replyMessage = aiResponse.reply;

  // Handle multiple items with individual notes (e.g., "2 burgers - one less spicy, one extra cheese")
  if (aiResponse.items && aiResponse.items.length > 0) {
    logger.info(`ADD_ITEM intent received for ${aiResponse.items.length} items with individual notes`);

    let lastSavedItemId: string | null = null;
    const addedItemNames: string[] = [];

    for (const itemData of aiResponse.items) {
      if (!itemData.name) continue;

      // Check for duplicates before adding
      const isDuplicate = isItemDuplicate(ctx.existingItems, itemData.name, itemData.size_or_weight);
      if (isDuplicate) {
        logger.info(`Duplicate item prevented: ${itemData.name}`);
        continue;
      }

      try {
        const savedItem = await saveOrderItem(ctx.session.id, {
          ...itemData,
          quantity: itemData.quantity || 1,
        }, ctx.businessId);
        logger.info(`Item SAVED to DB: ${itemData.name} (ID: ${savedItem.id}, notes: ${itemData.notes || 'none'})`);
        lastSavedItemId = savedItem.id;

        const itemDesc = itemData.notes
          ? `${itemData.name}${itemData.size_or_weight ? ` (${itemData.size_or_weight})` : ''} - ${itemData.notes}`
          : `${itemData.name}${itemData.size_or_weight ? ` (${itemData.size_or_weight})` : ''}`;
        addedItemNames.push(itemDesc);
      } catch (saveError) {
        logger.error(`Failed to save item to DB: ${itemData.name}`, saveError);
      }
    }

    if (lastSavedItemId) {
      await setLastAddedItem(ctx.session.id, lastSavedItemId);
    }

    if (addedItemNames.length > 0) {
      replyMessage = t('cart.addedMultiple', ctx.lang, {
        items: addedItemNames.map((n, i) => `${i + 1}. ${n}`).join('\n')
      });
    }

    return { reply: replyMessage };
  }

  // Handle single item
  if (aiResponse.item && aiResponse.item.name) {
    logger.info(`ADD_ITEM intent received for: ${aiResponse.item.name} (size: ${aiResponse.item.size_or_weight || 'default'}, qty: ${aiResponse.item.quantity || 1})`);

    // Check for duplicates before adding
    const isDuplicate = isItemDuplicate(
      ctx.existingItems,
      aiResponse.item.name,
      aiResponse.item.size_or_weight
    );

    if (isDuplicate) {
      logger.info(`Duplicate item prevented: ${aiResponse.item.name}`);
      // Don't add, but keep the AI's response (it should acknowledge it's already added)
      return { reply: replyMessage };
    }

    try {
      const savedItem = await saveOrderItem(ctx.session.id, aiResponse.item, ctx.businessId);
      logger.info(`Item SAVED to DB: ${aiResponse.item.name} (ID: ${savedItem.id})`);

      // Store last added item ID for add-on attachment
      await setLastAddedItem(ctx.session.id, savedItem.id);

      // Check for custom text prompt OR add-ons (ask separately, custom text first)
      if (ctx.menuItems && ctx.menuItems.length > 0) {
        const addedMenuItem = ctx.menuItems.find(
          mi => mi.name.toLowerCase() === aiResponse.item!.name.toLowerCase()
        );

        if (addedMenuItem && addedMenuItem.category_id) {
          // Check for category note (display only) and custom text prompt (expects input)
          let hasCustomTextPrompt = false;
          let categoryNoteToShow = '';

          if (ctx.menuCategories && ctx.menuCategories.length > 0) {
            const category = ctx.menuCategories.find(c => c.id === addedMenuItem.category_id);

            // Display-only note (no input expected)
            if (category?.category_note) {
              categoryNoteToShow = category.category_note;
              logger.info(`Category has display note: "${category.category_note}"`);
            }

            // Custom text prompt (expects input)
            if (category?.custom_text_prompt) {
              hasCustomTextPrompt = true;
              logger.info(`Category has custom_text_prompt: "${category.custom_text_prompt}"`);

              // Store pending custom text question for next message
              await setPendingCustomText(ctx.session.id, {
                itemId: savedItem.id,
                prompt: category.custom_text_prompt,
              });

              // Also store addons for AFTER custom text is collected
              const suggestedAddons = await getAutoSuggestedAddons(addedMenuItem.category_id);
              if (suggestedAddons.length > 0) {
                await setPendingAddonSelection(ctx.session.id, {
                  itemId: savedItem.id,
                  addonIds: suggestedAddons.map((a: any) => a.id),
                });
              }

              // REPLACE the AI reply - don't ask "Anything else?" when we need custom text
              const itemDesc = aiResponse.item?.size_or_weight
                ? `${addedMenuItem.name} (${aiResponse.item.size_or_weight})`
                : addedMenuItem.name;
              const notePrefix = categoryNoteToShow ? `_${categoryNoteToShow}_\n\n` : '';
              replyMessage = `${t('cart.added', ctx.lang, { item: itemDesc })}\n\n${notePrefix}${category.custom_text_prompt}`;
            } else if (categoryNoteToShow) {
              // Only display note (no input expected), continue with addons
              replyMessage = aiResponse.reply + `\n\n_${categoryNoteToShow}_`;
            }
          }

          // If no custom text prompt, check for add-ons directly
          if (!hasCustomTextPrompt) {
            const suggestedAddons = await getAutoSuggestedAddons(addedMenuItem.category_id);
            if (suggestedAddons.length > 0) {
              logger.info(`${suggestedAddons.length} add-ons available for ${addedMenuItem.name}`);
              const addonsMessage = formatAddonsForCustomer(suggestedAddons);
              replyMessage = aiResponse.reply + '\n\n' + addonsMessage;

              // Store pending addon selection for next message
              await setPendingAddonSelection(ctx.session.id, {
                itemId: savedItem.id,
                addonIds: suggestedAddons.map((a: any) => a.id),
              });
            }
          }
        }
      }
    } catch (saveError) {
      logger.error(`Failed to save item to DB: ${aiResponse.item.name}`, saveError);
      const supportPhone = ctx.business?.customer_support_phone;
      replyMessage = t('error.cartAddFailed', ctx.lang, {
        support: supportPhone ? t('error.contactSupport', ctx.lang, { phone: supportPhone }) : '',
      });
    }
  } else {
    logger.warn(`ADD_ITEM intent but missing item data: ${JSON.stringify(aiResponse)}`);
  }

  return { reply: replyMessage };
};
