import { Response } from 'express';
import { supabase } from '../../../config/database';
import { AuthRequest, getBusinessId } from '../../../middleware/auth';
import { logger } from '../../../utils/logger';

// List addon groups with their addons
export async function listAddonGroups(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Get all addons grouped by category
    const { data: addons, error } = await supabase
      .from('menu_addons')
      .select('*')
      .eq('business_id', businessId)
      .order('display_order', { ascending: true });

    if (error) {
      throw error;
    }

    // Group by category
    const groupMap = new Map<string, any[]>();
    (addons || []).forEach(addon => {
      const category = addon.category || 'Other';
      if (!groupMap.has(category)) {
        groupMap.set(category, []);
      }
      groupMap.get(category)?.push({
        id: addon.id,
        name: addon.name,
        description: addon.description,
        price: addon.price,
        is_available: addon.is_available,
        display_order: addon.display_order,
      });
    });

    const groups = Array.from(groupMap.entries()).map(([name, items]) => ({
      name,
      addons: items,
    }));

    res.status(200).json({ groups });
  } catch (error) {
    logger.error('Failed to list addon groups', error);
    res.status(500).json({ error: 'Failed to fetch addon groups' });
  }
}

// Create addon
export async function createAddon(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const {
      name,
      category,
      description,
      price,
      is_available = true,
    } = req.body;

    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    if (!category) {
      res.status(400).json({ error: 'category (group) is required' });
      return;
    }

    // Get max display_order for this category
    const { data: maxOrder } = await supabase
      .from('menu_addons')
      .select('display_order')
      .eq('business_id', businessId)
      .eq('category', category)
      .order('display_order', { ascending: false })
      .limit(1)
      .single();

    const displayOrder = (maxOrder?.display_order || 0) + 1;

    const { data: addon, error } = await supabase
      .from('menu_addons')
      .insert({
        business_id: businessId,
        name,
        category,
        description: description || null,
        price: price || null, // null = free
        is_available,
        display_order: displayOrder,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    logger.info(`Addon created: ${name}`);

    res.status(201).json({ addon });
  } catch (error) {
    logger.error('Failed to create addon', error);
    res.status(500).json({ error: 'Failed to create addon' });
  }
}

// Update addon
export async function updateAddon(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { addonId } = req.params;
    const { name, category, description, price, is_available } = req.body;

    // Verify addon belongs to this business
    const { data: existing } = await supabase
      .from('menu_addons')
      .select('id')
      .eq('id', addonId)
      .eq('business_id', businessId)
      .single();

    if (!existing) {
      res.status(404).json({ error: 'Addon not found' });
      return;
    }

    // Build update object
    const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name;
    if (category !== undefined) updateData.category = category;
    if (description !== undefined) updateData.description = description;
    if (price !== undefined) updateData.price = price;
    if (is_available !== undefined) updateData.is_available = is_available;

    const { data: addon, error } = await supabase
      .from('menu_addons')
      .update(updateData)
      .eq('id', addonId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    logger.info(`Addon updated: ${addonId}`);

    res.status(200).json({ addon });
  } catch (error) {
    logger.error('Failed to update addon', error);
    res.status(500).json({ error: 'Failed to update addon' });
  }
}

// Delete addon
export async function deleteAddon(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { addonId } = req.params;

    // Verify addon belongs to this business
    const { data: existing } = await supabase
      .from('menu_addons')
      .select('id')
      .eq('id', addonId)
      .eq('business_id', businessId)
      .single();

    if (!existing) {
      res.status(404).json({ error: 'Addon not found' });
      return;
    }

    // Delete category_addons links first
    await supabase
      .from('category_addons')
      .delete()
      .eq('addon_id', addonId);

    // Delete addon
    const { error } = await supabase
      .from('menu_addons')
      .delete()
      .eq('id', addonId);

    if (error) {
      throw error;
    }

    logger.info(`Addon deleted: ${addonId}`);

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Failed to delete addon', error);
    res.status(500).json({ error: 'Failed to delete addon' });
  }
}

// Link addon to category (for auto-suggestion)
export async function linkAddonToCategory(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { addon_id, category_id, is_auto_suggested = true } = req.body;

    if (!addon_id || !category_id) {
      res.status(400).json({ error: 'addon_id and categoryId are required' });
      return;
    }

    // Verify addon belongs to this business
    const { data: addon } = await supabase
      .from('menu_addons')
      .select('id')
      .eq('id', addon_id)
      .eq('business_id', businessId)
      .single();

    if (!addon) {
      res.status(404).json({ error: 'Addon not found' });
      return;
    }

    // Verify category belongs to this business
    const { data: category } = await supabase
      .from('menu_categories')
      .select('id')
      .eq('id', category_id)
      .eq('business_id', businessId)
      .single();

    if (!category) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }

    // Create link (upsert)
    const { error } = await supabase
      .from('category_addons')
      .upsert({
        menu_category_id: category_id,
        addon_id: addon_id,
        is_auto_suggested,
        created_at: new Date().toISOString(),
      }, {
        onConflict: 'menu_category_id,addon_id',
      });

    if (error) {
      throw error;
    }

    logger.info(`Addon ${addon_id} linked to category ${category_id}`);

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Failed to link addon to category', error);
    res.status(500).json({ error: 'Failed to link addon to category' });
  }
}

// Unlink addon from category
export async function unlinkAddonFromCategory(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { addon_id, category_id } = req.body;

    if (!addon_id || !category_id) {
      res.status(400).json({ error: 'addon_id and category_id are required' });
      return;
    }

    const { error } = await supabase
      .from('category_addons')
      .delete()
      .eq('addon_id', addon_id)
      .eq('menu_category_id', category_id);

    if (error) {
      throw error;
    }

    logger.info(`Addon ${addon_id} unlinked from category ${category_id}`);

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Failed to unlink addon from category', error);
    res.status(500).json({ error: 'Failed to unlink addon from category' });
  }
}

// Get category-addon links for a category
export async function getCategoryAddons(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { categoryId } = req.params;

    // Verify category belongs to this business
    const { data: category } = await supabase
      .from('menu_categories')
      .select('id')
      .eq('id', categoryId)
      .eq('business_id', businessId)
      .single();

    if (!category) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }

    // Get linked addons
    const { data: links, error } = await supabase
      .from('category_addons')
      .select(`
        id,
        addon_id,
        is_auto_suggested,
        suggestion_priority,
        addon:menu_addons(id, name, price, is_available)
      `)
      .eq('menu_category_id', categoryId);

    if (error) {
      throw error;
    }

    res.status(200).json({ addons: links || [] });
  } catch (error) {
    logger.error('Failed to get category addons', error);
    res.status(500).json({ error: 'Failed to fetch category addons' });
  }
}
