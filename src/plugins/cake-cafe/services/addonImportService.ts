import { supabase } from '@/config/database';
import { logger } from '@/utils/logger';

interface AddonRow {
  addon_name: string;
  category: string;
  description?: string;
  price?: string;
  image_url?:string
  link_to_categories?: string;
  is_auto_suggested?: string;
}

export async function importAddonsFromCSV(
  businessId: string,
  csvContent: string,
  replace: boolean = false
): Promise<{
  success: boolean;
  addonsCreated: number;
  addonsUpdated: number;
  linksCreated: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let addonsCreated = 0;
  let addonsUpdated = 0;
  let linksCreated = 0;

  try {
    // Parse CSV
    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('CSV file is empty or has no data rows');
    }

    const headers = lines[0].split(',').map(h => h.trim());
    const rows: AddonRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      const row: any = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      rows.push(row as AddonRow);
    }

    // Replace mode: delete existing add-ons
    if (replace) {
      await supabase
        .from('menu_addons')
        .delete()
        .eq('business_id', businessId);
      logger.info('Deleted existing add-ons for replace mode');
    }

    // Process each add-on
    for (const row of rows) {
      if (!row.addon_name) continue;

      const price = row.price && row.price !== '' ? parseFloat(row.price) : null;

      // Insert or update add-on
      const { data: addon, error: addonError } = await supabase
        .from('menu_addons')
        .upsert({
          business_id: businessId,
          name: row.addon_name,
          category: row.category || null,
          description: row.description || null,
          price,
          image_url: row.image_url || null,
          is_available: true,
          display_order: 0,
        }, {
          onConflict: 'business_id,name',
          ignoreDuplicates: false,
        })
        .select()
        .single();

      if (addonError) {
        errors.push(`Error importing ${row.addon_name}: ${addonError.message}`);
        continue;
      }

      if (!addon) {
        errors.push(`No addon data returned for ${row.addon_name}`);
        continue;
      }

      addonsCreated++;

      // Link to categories if specified
      if (row.link_to_categories) {
        const categoryNames = row.link_to_categories.split('|').map(c => c.trim());
        const isAutoSuggested = row.is_auto_suggested?.toLowerCase() === 'yes';

        for (const categoryName of categoryNames) {
          // Find category
          const { data: category } = await supabase
            .from('menu_categories')
            .select('id')
            .eq('business_id', businessId)
            .eq('name', categoryName)
            .single();

          if (category) {
            // Create link
            const { error: linkError } = await supabase
              .from('category_addons')
              .upsert({
                menu_category_id: category.id,
                addon_id: addon.id,
                is_auto_suggested: isAutoSuggested,
                suggestion_priority: 0,
              }, {
                onConflict: 'menu_category_id,addon_id',
                ignoreDuplicates: true,
              });

            if (!linkError) {
              linksCreated++;
            }
          } else {
            errors.push(`Category not found: ${categoryName} for ${row.addon_name}`);
          }
        }
      }
    }

    return {
      success: true,
      addonsCreated,
      addonsUpdated,
      linksCreated,
      errors,
    };
  } catch (error) {
    logger.error('Failed to import add-ons from CSV', error);
    throw error;
  }
}
