/**
 * Addon Intent Handlers
 *
 * Handlers for add-on related intents:
 * - suggest_addons: AI suggests add-ons
 * - add_addon: Customer wants to add an add-on
 * - remove_addon: Customer wants to remove an add-on
 */

import { IntentContext, IntentResult, IntentHandlerFn, IntentHandlerRegistry } from '../types';
import { AIResponse } from '../types';
import { t } from '../../../../i18n';
import { logger } from '../../../../utils/logger';
import {
  getAutoSuggestedAddons,
  addAddonToSessionItem,
  findAddonByCustomerInput,
  removeAddonFromSession,
} from '../../services/addonService';
import { setPendingAddonSelection } from '../../../../services/sessionService';

/**
 * Suggest Addons - AI is suggesting add-ons
 */
const suggestAddonsHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  logger.info('AI suggesting add-ons');
  // AI's reply already has formatted add-on suggestions
  return { reply: aiResponse.reply };
};

/**
 * Add Addon - Customer wants to add an add-on to their item
 */
const addAddonHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  if (!aiResponse.addon || !aiResponse.addon.addon_name) {
    return { reply: aiResponse.reply };
  }

  const lastItemId = ctx.session.last_added_item_id;

  if (!lastItemId) {
    logger.warn('No last item found for add-on attachment');
    return { reply: t('addons.noItemForAddon', ctx.lang) };
  }

  // Get the last added item to find its category
  const lastItem = ctx.existingItems.find(item => item.id === lastItemId);
  if (!lastItem) {
    logger.warn(`Last item ${lastItemId} not found in session items`);
    return { reply: t('addons.noItemForAddon', ctx.lang) };
  }

  const menuItem = ctx.menuItems.find(
    mi => mi.name.toLowerCase() === lastItem.item_name.toLowerCase()
  );

  if (!menuItem || !menuItem.category_id) {
    logger.warn(`Menu item or category not found for: ${lastItem.item_name}`);
    return { reply: aiResponse.reply };
  }

  const availableAddons = await getAutoSuggestedAddons(menuItem.category_id);

  // Try to match addon by customer input (could be number or name)
  let selectedAddon = findAddonByCustomerInput(ctx.messageText, availableAddons);

  // If not found, try by AI-provided name
  if (!selectedAddon) {
    selectedAddon = availableAddons.find(
      addon => addon.name.toLowerCase() === aiResponse.addon!.addon_name.toLowerCase()
    ) || null;
  }

  if (selectedAddon) {
    await addAddonToSessionItem(lastItemId, selectedAddon.id, aiResponse.addon.quantity || 1);
    logger.info(`Add-on added: ${selectedAddon.name} to item ${lastItemId}`);

    // Build confirmation message
    const priceText = selectedAddon.price ? ` (₹${selectedAddon.price})` : ' (FREE)';
    let replyMessage = t('addons.added', ctx.lang, { addon: `${selectedAddon.name}${priceText}` });

    // Append AI's reply if it has additional context
    if (aiResponse.reply && !aiResponse.reply.includes('Added')) {
      replyMessage += `! ${aiResponse.reply}`;
    }

    return { reply: replyMessage };
  } else {
    logger.warn(`Add-on not found: ${aiResponse.addon.addon_name}`);
    return { reply: t('addons.notAvailable', ctx.lang) };
  }
};

/**
 * Remove Addon - Customer wants to remove an add-on from their order
 */
const removeAddonHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  if (!aiResponse.addon || !aiResponse.addon.addon_name) {
    return { reply: t('addons.whichRemove', ctx.lang) };
  }

  const removeResult = await removeAddonFromSession(ctx.session.id, aiResponse.addon.addon_name);

  if (removeResult.success) {
    logger.info(`Add-on removed: ${removeResult.addonName} from ${removeResult.itemName}`);

    // Clear pending addon selection if exists
    await setPendingAddonSelection(ctx.session.id, null);

    return {
      reply: t('addons.removed', ctx.lang, {
        addonName: removeResult.addonName ?? '',
        itemName: removeResult.itemName ?? ''
      })
    };
  } else {
    logger.warn(`Failed to remove addon: ${aiResponse.addon.addon_name}`);
    return { reply: t('addons.notFound', ctx.lang, { addon: aiResponse.addon.addon_name }) };
  }
};

/**
 * Export addon handlers as a registry fragment
 */
export const addonHandlers: IntentHandlerRegistry = {
  suggest_addons: suggestAddonsHandler,
  add_addon: addAddonHandler,
  remove_addon: removeAddonHandler,
};
