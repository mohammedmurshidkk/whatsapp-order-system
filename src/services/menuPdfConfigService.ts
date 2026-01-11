/**
 * Menu PDF Config Service
 * CRUD operations for menu_pdf_configs table
 */
import { supabase } from '../config/database';
import { MenuPdfConfig } from '../types';
import { logger } from '../utils/logger';
import { generateMenuPdf, uploadMenuPdfWithName } from './pdfService';

/**
 * Generate slug from name
 */
function generateSlug(name: string): string {
    return name.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

/**
 * Create a new menu PDF config
 */
export async function createMenuPdfConfig(
    businessId: string,
    name: string,
    categoryIds: string[],
    i18n?: { name_en?: string; name_local?: string }
): Promise<MenuPdfConfig> {
    const slug = generateSlug(name);

    const insertData: Record<string, unknown> = {
        business_id: businessId,
        name,
        slug,
        category_ids: categoryIds,
    };

    if (i18n?.name_en) insertData.name_en = i18n.name_en;
    if (i18n?.name_local) insertData.name_local = i18n.name_local;

    const { data, error } = await supabase
        .from('menu_pdf_configs')
        .insert(insertData)
        .select()
        .single();

    if (error) throw error;
    logger.info(`Created menu PDF config: ${data.id} (${name})`);
    return data;
}

/**
 * Get all menu PDF configs for a business
 */
export async function getMenuPdfConfigs(businessId: string): Promise<MenuPdfConfig[]> {
    const { data, error } = await supabase
        .from('menu_pdf_configs')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
}

/**
 * Get a menu PDF config by ID
 */
export async function getMenuPdfConfigById(id: string): Promise<MenuPdfConfig | null> {
    const { data, error } = await supabase
        .from('menu_pdf_configs')
        .select('*')
        .eq('id', id)
        .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows found
    return data || null;
}

/**
 * Update a menu PDF config
 */
export async function updateMenuPdfConfig(
    id: string,
    updates: { name?: string; categoryIds?: string[]; isActive?: boolean; name_en?: string; name_local?: string }
): Promise<MenuPdfConfig | null> {
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (updates.name !== undefined) {
        updateData.name = updates.name;
        updateData.slug = generateSlug(updates.name);
    }

    if (updates.categoryIds !== undefined) {
        updateData.category_ids = updates.categoryIds;
    }

    if (updates.isActive !== undefined) {
        updateData.is_active = updates.isActive;
    }

    if (updates.name_en !== undefined) {
        updateData.name_en = updates.name_en;
    }

    if (updates.name_local !== undefined) {
        updateData.name_local = updates.name_local;
    }

    const { data, error } = await supabase
        .from('menu_pdf_configs')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
}

/**
 * Delete a menu PDF config
 */
export async function deleteMenuPdfConfig(id: string): Promise<void> {
    const { error } = await supabase
        .from('menu_pdf_configs')
        .delete()
        .eq('id', id);

    if (error) throw error;
    logger.info(`Deleted menu PDF config: ${id}`);
}

/**
 * Sync (generate and upload) PDF for a config
 */
export async function syncMenuPdfConfig(id: string): Promise<string | null> {
    const config = await getMenuPdfConfigById(id);
    if (!config) {
        logger.warn(`Menu PDF config not found: ${id}`);
        return null;
    }

    try {
        // Generate PDF with category filter
        const pdfBuffer = await generateMenuPdf(config.business_id, config.category_ids);

        // Upload with custom name
        const pdfUrl = await uploadMenuPdfWithName(config.business_id, pdfBuffer, config.slug);

        // Update config with new URL
        await supabase
            .from('menu_pdf_configs')
            .update({ pdf_url: pdfUrl, updated_at: new Date().toISOString() })
            .eq('id', id);

        logger.info(`Synced menu PDF config ${id}: ${pdfUrl}`);
        return pdfUrl;
    } catch (error) {
        logger.error(`Failed to sync menu PDF config ${id}:`, error);
        throw error;
    }
}

/**
 * Get all active menu PDF configs with PDFs (for sending to customer)
 */
export async function getActiveMenuPdfConfigs(businessId: string): Promise<MenuPdfConfig[]> {
    const { data, error } = await supabase
        .from('menu_pdf_configs')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .not('pdf_url', 'is', null)  // Only configs with generated PDFs
        .order('name', { ascending: true });

    if (error) throw error;
    return data || [];
}

/**
 * Get menu PDF config by slug (for specific menu requests)
 */
export async function getMenuPdfConfigBySlug(
    businessId: string,
    slug: string
): Promise<MenuPdfConfig | null> {
    const { data, error } = await supabase
        .from('menu_pdf_configs')
        .select('*')
        .eq('business_id', businessId)
        .eq('slug', slug)
        .eq('is_active', true)
        .single();

    if (error) return null;
    return data;
}

/**
 * Get localized name for a menu PDF config based on language
 * Falls back to: name_local -> name_en -> name
 */
export function getLocalizedMenuName(config: MenuPdfConfig, lang: string): string {
    if (lang !== 'en' && config.name_local) {
        return config.name_local;
    }
    return config.name_en || config.name;
}
