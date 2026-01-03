import { Response } from 'express';
import { supabase } from '../config/database';
import { AuthRequest, getBusinessId } from '../middleware/auth';
import { clearMenuCache } from '../services/menuService';
import { logger } from '../utils/logger';

// List categories
export async function listCategories(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Get categories with item count
    const { data: categories, error } = await supabase
      .from('menu_categories')
      .select(`
        id,
        name,
        description,
        display_order,
        is_active,
        created_at,
        custom_text_prompt,
        category_note,
        allows_custom_weight,
        custom_weight_base_size,
        custom_weight_min_grams
      `)
      .eq('business_id', businessId)
      .order('display_order', { ascending: true });

    if (error) {
      throw error;
    }

    // Get item counts for each category
    const { data: itemCounts } = await supabase
      .from('menu_items')
      .select('category_id')
      .eq('business_id', businessId);

    const countMap = new Map<string, number>();
    (itemCounts || []).forEach(item => {
      if (item.category_id) {
        countMap.set(item.category_id, (countMap.get(item.category_id) || 0) + 1);
      }
    });

    const enrichedCategories = (categories || []).map(cat => ({
      ...cat,
      items_count: countMap.get(cat.id) || 0,
    }));

    res.status(200).json({ categories: enrichedCategories });
  } catch (error) {
    logger.error('Failed to list categories', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
}

// Create category
export async function createCategory(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const {
      name,
      description,
      custom_text_prompt,
      category_note,
      is_active = true,
      allows_custom_weight,
      custom_weight_base_size,
      custom_weight_min_grams
    } = req.body;

    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    // Get max display_order
    const { data: maxOrder } = await supabase
      .from('menu_categories')
      .select('display_order')
      .eq('business_id', businessId)
      .order('display_order', { ascending: false })
      .limit(1)
      .single();

    const displayOrder = (maxOrder?.display_order || 0) + 1;

    const { data: category, error } = await supabase
      .from('menu_categories')
      .insert({
        business_id: businessId,
        name,
        description: description || null,
        display_order: displayOrder,
        custom_text_prompt: custom_text_prompt,
        category_note: category_note,
        is_active,
        allows_custom_weight,
        custom_weight_base_size: allows_custom_weight ? custom_weight_base_size : null,
        custom_weight_min_grams: allows_custom_weight ? custom_weight_min_grams : null,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    logger.info(`Category created: ${name}`);

    res.status(201).json({ category });
  } catch (error) {
    logger.error('Failed to create category', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
}

// Update category
export async function updateCategory(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { categoryId } = req.params;
    const {
      name,
      description,
      display_order,
      custom_text_prompt,
      category_note,
      is_active,
      allows_custom_weight,
      custom_weight_base_size,
      custom_weight_min_grams
    } = req.body;

    // Verify category belongs to this business
    const { data: existing } = await supabase
      .from('menu_categories')
      .select('id')
      .eq('id', categoryId)
      .eq('business_id', businessId)
      .single();

    if (!existing) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }

    // Build update object
    const updateData: Record<string, any> = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (display_order !== undefined) updateData.display_order = display_order;
    if (custom_text_prompt !== undefined) updateData.custom_text_prompt = custom_text_prompt;
    if (category_note !== undefined) updateData.category_note = category_note;
    if (is_active !== undefined) updateData.is_active = is_active;
    if (allows_custom_weight !== undefined) updateData.allows_custom_weight = allows_custom_weight;
    if (custom_weight_base_size !== undefined) updateData.custom_weight_base_size = custom_weight_base_size;
    if (custom_weight_min_grams !== undefined) updateData.custom_weight_min_grams = custom_weight_min_grams;

    const { data: category, error } = await supabase
      .from('menu_categories')
      .update(updateData)
      .eq('id', categoryId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Clear menu cache since categories affect menu
    clearMenuCache(businessId);

    logger.info(`Category updated: ${categoryId}`);

    res.status(200).json({ category });
  } catch (error) {
    logger.error('Failed to update category', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
}

// Delete category
export async function deleteCategory(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { categoryId } = req.params;

    // Verify category belongs to this business
    const { data: existing } = await supabase
      .from('menu_categories')
      .select('id')
      .eq('id', categoryId)
      .eq('business_id', businessId)
      .single();

    if (!existing) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }

    // Check if category has items
    const { count } = await supabase
      .from('menu_items')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', categoryId);

    if (count && count > 0) {
      res.status(400).json({
        error: `Cannot delete category with ${count} items. Move or delete items first.`,
      });
      return;
    }

    const { error } = await supabase
      .from('menu_categories')
      .delete()
      .eq('id', categoryId);

    if (error) {
      throw error;
    }

    // Clear menu cache
    clearMenuCache(businessId);

    logger.info(`Category deleted: ${categoryId}`);

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Failed to delete category', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
}

// Reorder categories
export async function reorderCategories(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { order } = req.body; // Array of { id, display_order }

    if (!Array.isArray(order)) {
      res.status(400).json({ error: 'order must be an array' });
      return;
    }

    // Update each category's display_order
    for (const item of order) {
      await supabase
        .from('menu_categories')
        .update({ display_order: item.display_order })
        .eq('id', item.id)
        .eq('business_id', businessId);
    }

    // Clear menu cache
    clearMenuCache(businessId);

    logger.info(`Categories reordered for business: ${businessId}`);

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Failed to reorder categories', error);
    res.status(500).json({ error: 'Failed to reorder categories' });
  }
}
