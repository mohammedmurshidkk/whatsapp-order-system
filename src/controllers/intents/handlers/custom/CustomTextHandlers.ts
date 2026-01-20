/**
 * Custom Text Intent Handlers
 *
 * Handlers for custom text (e.g., cake message) related intents:
 * - save_custom_text: Save custom text for an item
 * - modify_custom_text: Change existing custom text
 * - remove_custom_text: Remove custom text entirely
 */

import { IntentContext, IntentResult, IntentHandlerFn, IntentHandlerRegistry } from '../../types';
import { AIResponse, SessionItem } from '../../../../types';
import { t } from '../../../../i18n';
import { logger } from '../../../../utils/logger';
import {
  updateSessionItemCustomText,
  setPendingCustomText,
} from '../../../../services/sessionService';

/**
 * Extract custom text from message if AI didn't provide it
 */
function extractCustomTextFromMessage(messageText: string): string | null {
  // Pattern: "change text to X", "update message to X", "write X instead"
  const match = messageText.match(
    /(?:change|update|make it|write)\s*(?:the\s*)?(?:text|message|writing)?\s*(?:to|into|as)?\s*["']?(.+?)["']?\s*$/i
  );
  if (match) {
    return match[1].replace(/^["']|["']$/g, '').trim();
  }
  return null;
}

/**
 * Find the target item for custom text based on various signals
 */
function findTargetItemForCustomText(
  existingItems: SessionItem[],
  messageText: string,
  aiItemName?: string
): SessionItem | null {
  // 1. Check if AI provided item name
  if (aiItemName) {
    const aiItemMatch = existingItems.find(item =>
      item.item_name.toLowerCase().includes(aiItemName.toLowerCase()) ||
      aiItemName.toLowerCase().includes(item.item_name.toLowerCase())
    );
    if (aiItemMatch) return aiItemMatch;
  }

  // 2. Try to extract item name from user message
  // Patterns: "on Black Forest", "on the Rainbow cake", "for chocolate cake"
  const itemNameMatch = messageText.match(/(?:on|for|to)\s*(?:the\s*)?["']?([a-zA-Z\s]+?)["']?\s*(?:cake)?$/i) ||
    messageText.match(/["']?([a-zA-Z\s]+?)["']?\s*(?:cake)?\s*(?:text|message|writing)/i);

  if (itemNameMatch) {
    const mentionedItem = itemNameMatch[1].trim().toLowerCase();
    const matchedItem = existingItems.find(item =>
      item.item_name.toLowerCase().includes(mentionedItem) ||
      mentionedItem.includes(item.item_name.toLowerCase())
    );
    if (matchedItem) return matchedItem;
  }

  // 3. Check for item names mentioned anywhere in the message
  for (const item of existingItems) {
    if (messageText.toLowerCase().includes(item.item_name.toLowerCase())) {
      return item;
    }
  }

  // 4. Fallback: item with existing custom_text or last added item
  return existingItems.find(item => item.custom_text) || existingItems[existingItems.length - 1] || null;
}

/**
 * Save Custom Text - Save custom text response (e.g., cake message)
 */
const saveCustomTextHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  // Try to extract text from AI response or from user message
  let customTextToSave = aiResponse.customText || extractCustomTextFromMessage(ctx.messageText);

  if (customTextToSave) {
    const lastItemId = ctx.session.last_added_item_id;
    if (lastItemId) {
      await updateSessionItemCustomText(lastItemId, customTextToSave);
      logger.info(`Custom text saved: "${customTextToSave}" for item ${lastItemId}`);
      // Clear pending custom text if exists
      await setPendingCustomText(ctx.session.id, null);
    } else {
      logger.warn('No last item found for custom text');
    }
  }

  return { reply: aiResponse.reply };
};

/**
 * Modify Custom Text - Customer wants to change the cake writing
 */
const modifyCustomTextHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  let newCustomText = aiResponse.customText || extractCustomTextFromMessage(ctx.messageText);

  // Filter items that could have custom text (typically cakes)
  const customizableItems = ctx.existingItems.filter(item => {
    const itemNameLower = item.item_name.toLowerCase();
    return itemNameLower.includes('cake') || itemNameLower.includes('pastry') ||
      itemNameLower.includes('cupcake') || item.custom_text;
  });

  if (newCustomText) {
    // Find the specific item to update
    const itemToUpdate = findTargetItemForCustomText(
      ctx.existingItems,
      ctx.messageText,
      aiResponse.item?.name
    );

    if (itemToUpdate) {
      await updateSessionItemCustomText(itemToUpdate.id, newCustomText);
      logger.info(`Custom text modified: "${newCustomText}" for item ${itemToUpdate.id} (${itemToUpdate.item_name})`);
      await setPendingCustomText(ctx.session.id, null);
      return { reply: t('customText.updated', ctx.lang, { item: itemToUpdate.item_name, text: newCustomText }) };
    } else {
      logger.warn('No item found to update custom text');
      return { reply: t('customText.updateFailedNoItem', ctx.lang) };
    }
  } else {
    // No custom text provided - need to SET pending state to wait for user's response

    // Check if multiple customizable items exist and user didn't specify which one
    if (customizableItems.length > 1) {
      // Check if user mentioned a specific item
      const itemToUpdate = findTargetItemForCustomText(
        ctx.existingItems,
        ctx.messageText,
        aiResponse.item?.name
      );
      const userMentionedSpecificItem = ctx.existingItems.some(item =>
        ctx.messageText.toLowerCase().includes(item.item_name.toLowerCase())
      );

      if (!userMentionedSpecificItem) {
        // Multiple cakes and user didn't specify - ask which one
        const cakeList = customizableItems.map((item, i) => `${i + 1}. ${item.item_name}`).join('\n');
        return { reply: t('customText.clarifyItem', ctx.lang, { items: cakeList }) };
      }

      // User mentioned specific item
      if (itemToUpdate) {
        await setPendingCustomText(ctx.session.id, {
          itemId: itemToUpdate.id,
          prompt: t('customText.askPromptForItem', ctx.lang, { item: itemToUpdate.item_name }),
        });
        return { reply: t('customText.askPromptForItem', ctx.lang, { item: itemToUpdate.item_name }) };
      } else {
        return { reply: t('customText.addFailedNoItem', ctx.lang) };
      }
    } else {
      // Single item or no ambiguity
      const itemToUpdate = findTargetItemForCustomText(
        ctx.existingItems,
        ctx.messageText,
        aiResponse.item?.name
      );

      if (itemToUpdate) {
        await setPendingCustomText(ctx.session.id, {
          itemId: itemToUpdate.id,
          prompt: t('customText.askPromptForItem', ctx.lang, { item: itemToUpdate.item_name }),
        });
        return { reply: t('customText.askPromptForItem', ctx.lang, { item: itemToUpdate.item_name }) };
      } else {
        return { reply: t('customText.updateFailedNoItem', ctx.lang) };
      }
    }
  }
};

/**
 * Remove Custom Text - Customer wants to remove the cake writing entirely
 */
const removeCustomTextHandler: IntentHandlerFn = async (ctx, aiResponse) => {
  const itemWithText = ctx.existingItems.find(item => item.custom_text);

  if (itemWithText) {
    await updateSessionItemCustomText(itemWithText.id, ''); // Clear the custom text
    logger.info(`Custom text removed for item ${itemWithText.id}`);
    // Clear pending custom text if exists
    await setPendingCustomText(ctx.session.id, null);
    return { reply: t('customText.removed', ctx.lang, { item: itemWithText.item_name }) };
  } else {
    logger.warn('No item found with custom text to remove');
    await setPendingCustomText(ctx.session.id, null);
    return { reply: t('customText.removeFailedNoText', ctx.lang) };
  }
};

/**
 * Export custom text handlers as a registry fragment
 */
export const customTextHandlers: IntentHandlerRegistry = {
  save_custom_text: saveCustomTextHandler,
  modify_custom_text: modifyCustomTextHandler,
  remove_custom_text: removeCustomTextHandler,
};
