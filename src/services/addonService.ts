import { supabase } from '../config/database';
import { MenuAddon, CategoryAddon, SessionItemAddon } from '../types';
import { logger } from '../utils/logger';

/**
 * Get all active add-ons for a business
 */
export async function getBusinessAddons(businessId: string): Promise<MenuAddon[]> {
  const { data, error } = await supabase
    .from('menu_addons')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_available', true)
    .order('category', { ascending: true })
    .order('display_order', { ascending: true });

  if (error) {
    logger.error('Failed to fetch add-ons', error);
    return [];
  }

  return (data || []) as MenuAddon[];
}

/**
 * Get auto-suggested add-ons for a menu category
 */
export async function getAutoSuggestedAddons(categoryId: string): Promise<MenuAddon[]> {
  const { data, error } = await supabase
    .from('category_addons')
    .select(`
      *,
      addon:menu_addons(*)
    `)
    .eq('menu_category_id', categoryId)
    .eq('is_auto_suggested', true)
    .order('suggestion_priority', { ascending: true });

  if (error) {
    logger.error('Failed to fetch auto-suggested add-ons', error);
    return [];
  }

  // Extract addon objects from the result
  const addons = (data || [])
    .map((ca: any) => ca.addon)
    .filter((addon: any) => addon && addon.is_available);

  return addons as MenuAddon[];
}

/**
 * Get addon by ID
 */
export async function getAddonById(addonId: string): Promise<MenuAddon | null> {
  const { data, error } = await supabase
    .from('menu_addons')
    .select('*')
    .eq('id', addonId)
    .eq('is_available', true)
    .single();

  if (error || !data) {
    return null;
  }

  return data as MenuAddon;
}

/**
 * Get multiple addons by IDs
 */
export async function getAddonsByIds(addonIds: string[]): Promise<MenuAddon[]> {
  if (!addonIds || addonIds.length === 0) return [];

  const { data, error } = await supabase
    .from('menu_addons')
    .select('*')
    .in('id', addonIds)
    .eq('is_available', true);

  if (error) {
    logger.error('Failed to fetch addons by IDs', error);
    return [];
  }

  return (data || []) as MenuAddon[];
}

/**
 * Find addon by name (fuzzy match)
 */
export async function findAddonByName(
  addonName: string,
  businessId: string
): Promise<MenuAddon | null> {
  const normalizedName = addonName.toLowerCase().trim();

  const { data, error } = await supabase
    .from('menu_addons')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_available', true);

  if (error || !data) {
    return null;
  }

  // Exact match first
  let found = data.find(
    addon => addon.name.toLowerCase() === normalizedName
  );

  // Partial match
  if (!found) {
    found = data.find(
      addon =>
        addon.name.toLowerCase().includes(normalizedName) ||
        normalizedName.includes(addon.name.toLowerCase())
    );
  }

  return found as MenuAddon || null;
}

/**
 * Add an addon to a session item
 */
export async function addAddonToSessionItem(
  sessionItemId: string,
  addonId: string,
  quantity: number = 1
): Promise<SessionItemAddon> {
  // Get addon details for price
  const addon = await getAddonById(addonId);

  if (!addon) {
    throw new Error('Add-on not found');
  }

  const { data, error } = await supabase
    .from('session_item_addons')
    .insert({
      session_item_id: sessionItemId,
      addon_id: addonId,
      addon_name: addon.name,
      quantity,
      unit_price: addon.price,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to add addon to session item', error);
    throw new Error('Failed to add addon');
  }

  logger.info(`Add-on added: ${addon.name} (${addon.price ? `₹${addon.price}` : 'FREE'}) to item ${sessionItemId}`);
  return data as SessionItemAddon;
}

/**
 * Get all addons for a session item
 */
export async function getSessionItemAddons(sessionItemId: string): Promise<SessionItemAddon[]> {
  const { data, error } = await supabase
    .from('session_item_addons')
    .select('*')
    .eq('session_item_id', sessionItemId)
    .order('created_at', { ascending: true });

  if (error) {
    logger.error('Failed to fetch session item addons', error);
    return [];
  }

  return (data || []) as SessionItemAddon[];
}

/**
 * Remove an addon from a session item
 */
export async function removeAddonFromSessionItem(
  sessionItemId: string,
  addonName: string
): Promise<boolean> {
  const normalizedName = addonName.toLowerCase().trim();

  // Find the addon first
  const { data: addons } = await supabase
    .from('session_item_addons')
    .select('*')
    .eq('session_item_id', sessionItemId);

  if (!addons || addons.length === 0) return false;

  // Find matching addon
  const matchingAddon = addons.find(addon =>
    addon.addon_name.toLowerCase().includes(normalizedName) ||
    normalizedName.includes(addon.addon_name.toLowerCase())
  );

  if (!matchingAddon) return false;

  // Delete the addon
  const { error } = await supabase
    .from('session_item_addons')
    .delete()
    .eq('id', matchingAddon.id);

  if (error) {
    logger.error('Failed to remove addon', error);
    return false;
  }

  logger.info(`Add-on removed: ${matchingAddon.addon_name}`);
  return true;
}

/**
 * Format addons list for customer display
 */
export function formatAddonsForCustomer(addons: MenuAddon[]): string {
  if (addons.length === 0) {
    return 'No add-ons available.';
  }

  let message = '🎁 *Would you like to add any of these?*\n\n';

  addons.forEach((addon, index) => {
    message += `${index + 1}. ${addon.name}`;

    if (addon.price !== null && addon.price > 0) {
      message += ` - ₹${addon.price}`;
    } else {
      message += ' - FREE';
    }

    if (addon.description) {
      message += `\n   _${addon.description}_`;
    }

    message += '\n\n';
  });

  message += '_Reply with numbers (e.g., "1, 3" for multiple) or names to add, or say "no thanks" to skip_';

  return message;
}

/**
 * Format addons for AI context
 */
export function formatAddonsForAI(addons: MenuAddon[]): string {
  if (addons.length === 0) {
    return 'No add-ons available.';
  }

  let text = 'AVAILABLE ADD-ONS:\n';
  addons.forEach((addon, index) => {
    text += `${index + 1}. ID: ${addon.id} | Name: "${addon.name}" | Price: ${addon.price !== null ? `₹${addon.price}` : 'FREE'}\n`;
  });

  return text;
}

/**
 * Find addon by customer input (number or name)
 * Handles: "1", "one", "candle", "one candle", "add candle", "sparkler candle", etc.
 */
export function findAddonByCustomerInput(
  input: string,
  addons: MenuAddon[]
): MenuAddon | null {
  const normalizedInput = input.toLowerCase().trim();

  // Word to number mapping
  const wordNumbers: Record<string, number> = {
    'one': 1, 'first': 1, '1st': 1,
    'two': 2, 'second': 2, '2nd': 2,
    'three': 3, 'third': 3, '3rd': 3,
    'four': 4, 'fourth': 4, '4th': 4,
    'five': 5, 'fifth': 5, '5th': 5,
  };

  // Check if input is a number (1, 2, 3...)
  const numberMatch = normalizedInput.match(/^(\d+)$/);
  if (numberMatch) {
    const index = parseInt(numberMatch[1], 10) - 1;
    if (index >= 0 && index < addons.length) {
      return addons[index];
    }
  }

  // Check if input starts with a word number ("one candle", "first one", etc.)
  for (const [word, num] of Object.entries(wordNumbers)) {
    if (normalizedInput.startsWith(word) || normalizedInput === word) {
      const index = num - 1;
      if (index >= 0 && index < addons.length) {
        return addons[index];
      }
    }
  }

  // Check if input contains a number anywhere ("add 1", "option 2", etc.)
  const anyNumberMatch = normalizedInput.match(/(\d+)/);
  if (anyNumberMatch) {
    const index = parseInt(anyNumberMatch[1], 10) - 1;
    if (index >= 0 && index < addons.length) {
      return addons[index];
    }
  }

  // Extract keywords from input (remove common words)
  const stopWords = ['add', 'want', 'need', 'please', 'also', 'the', 'a', 'an', 'one', 'yes', 'ok', 'okay'];
  const inputWords = normalizedInput.split(/\s+/).filter(w => !stopWords.includes(w));

  // Check if any word in input matches any word in addon name
  for (const addon of addons) {
    const addonWords = addon.name.toLowerCase().split(/\s+/);

    // Check for any word match
    for (const inputWord of inputWords) {
      if (inputWord.length >= 3) { // Only match words with 3+ chars
        for (const addonWord of addonWords) {
          if (addonWord.includes(inputWord) || inputWord.includes(addonWord)) {
            return addon;
          }
        }
      }
    }
  }

  // Fallback: Check if input matches addon name directly
  const matchedAddon = addons.find(addon =>
    addon.name.toLowerCase().includes(normalizedInput) ||
    normalizedInput.includes(addon.name.toLowerCase())
  );

  return matchedAddon || null;
}

/**
 * Find multiple addons by customer input (multi-select)
 * Handles: "1, 3", "1 and 2", "candle and balloon", "candle, balloon", etc.
 */
export function findMultipleAddonsByInput(
  input: string,
  addons: MenuAddon[]
): MenuAddon[] {
  const normalizedInput = input.toLowerCase().trim();
  const foundAddons: MenuAddon[] = [];
  const foundIds = new Set<string>();

  // Split by common separators: comma, "and", "&", space with numbers
  const parts = normalizedInput
    .split(/[,&]|\band\b|\s+(?=\d)/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  // If only one part and it might be a single addon
  if (parts.length === 1) {
    const single = findAddonByCustomerInput(normalizedInput, addons);
    if (single) return [single];
  }

  // Try to find addon for each part
  for (const part of parts) {
    const addon = findAddonByCustomerInput(part, addons);
    if (addon && !foundIds.has(addon.id)) {
      foundAddons.push(addon);
      foundIds.add(addon.id);
    }
  }

  // Also check for numbers anywhere in input (e.g., "1 3" or "1, 3")
  const numberMatches = normalizedInput.match(/\d+/g);
  if (numberMatches) {
    for (const numStr of numberMatches) {
      const index = parseInt(numStr, 10) - 1;
      if (index >= 0 && index < addons.length) {
        const addon = addons[index];
        if (!foundIds.has(addon.id)) {
          foundAddons.push(addon);
          foundIds.add(addon.id);
        }
      }
    }
  }

  return foundAddons;
}

/**
 * Calculate total price for addons on a session item
 */
export function calculateAddonsTotal(addons: SessionItemAddon[]): number {
  return addons.reduce((total, addon) => {
    const price = addon.unit_price || 0;
    return total + (price * addon.quantity);
  }, 0);
}

/**
 * Remove an addon from any item in a session (searches all session items)
 * Returns the removed addon name if successful, null otherwise
 */
export async function removeAddonFromSession(
  sessionId: string,
  addonName: string
): Promise<{ success: boolean; addonName?: string; itemName?: string }> {
  const normalizedName = addonName.toLowerCase().trim();

  // Get all session items for this session
  const { data: sessionItems } = await supabase
    .from('session_items')
    .select('id, item_name')
    .eq('session_id', sessionId);

  if (!sessionItems || sessionItems.length === 0) {
    return { success: false };
  }

  // Check each session item for the addon
  for (const item of sessionItems) {
    const { data: addons } = await supabase
      .from('session_item_addons')
      .select('*')
      .eq('session_item_id', item.id);

    if (!addons || addons.length === 0) continue;

    // Find matching addon
    const matchingAddon = addons.find(addon =>
      addon.addon_name.toLowerCase().includes(normalizedName) ||
      normalizedName.includes(addon.addon_name.toLowerCase())
    );

    if (matchingAddon) {
      // Delete the addon
      const { error } = await supabase
        .from('session_item_addons')
        .delete()
        .eq('id', matchingAddon.id);

      if (error) {
        logger.error('Failed to remove addon from session', error);
        return { success: false };
      }

      logger.info(`Add-on removed: ${matchingAddon.addon_name} from ${item.item_name}`);
      return {
        success: true,
        addonName: matchingAddon.addon_name,
        itemName: item.item_name
      };
    }
  }

  return { success: false };
}
