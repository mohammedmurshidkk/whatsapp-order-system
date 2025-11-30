import { supabase } from '../config/database';
import { AddOn, MenuCategory, MenuItem, MenuItemSize } from '../types';
import { logger } from '../utils/logger';

const ADDON_CATEGORY_NAME = '_Add-on';

interface CSVMenuRow {
  category: string;
  item_name: string;
  description: string;
  price: string;
  sizes: string;
  is_customizable: string;
  requires_date: string;
  special_notes: string;
  available_add_ons?: string; // new
  related_items?: string; // new
}

interface ImportResult {
  success: boolean;
  categoriesCreated: number;
  itemsCreated: number;
  itemsUpdated: number;
  addOnsCreated: number;
  addOnsUpdated: number;
  errors: string[];
}

// Parse CSV string to rows
function parseCSV(csvContent: string): CSVMenuRow[] {
  const lines = csvContent.trim().split('\n');

  if (lines.length < 2) {
    throw new Error('CSV must have a header row and at least one data row');
  }

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const rows: CSVMenuRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);

    if (values.length === 0 || values.every(v => v === '')) continue;

    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      // Ensure we don't try to access an index that doesn't exist
      row[header] = values[index]?.trim() || '';
    });

    if (!row.category && !row.item_name) continue;

    rows.push(row as unknown as CSVMenuRow);
  }

  return rows;
}

// Parse a single CSV line handling quoted fields
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"' && (i === 0 || line[i - 1] !== '\\')) {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.replace(/^"|"$/g, '').replace(/""/g, '"'));
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.replace(/^"|"$/g, '').replace(/""/g, '"'));
  return result;
}

// Parse sizes string like "500g:400|1kg:750|2kg:1400"
function parseSizes(sizesStr: string): MenuItemSize[] | null {
  if (!sizesStr || sizesStr.trim() === '') {
    return null;
  }

  const sizes: MenuItemSize[] = [];
  const sizeEntries = sizesStr.split('|');

  for (const entry of sizeEntries) {
    const [name, priceStr] = entry.split(':').map(s => s.trim());
    if (name && priceStr) {
      const price = parseFloat(priceStr);
      if (!isNaN(price)) {
        sizes.push({ name, price });
      }
    }
  }

  return sizes.length > 0 ? sizes : null;
}

// Convert yes/no/true/false to boolean
function parseBoolean(value: string): boolean {
  if (!value) return false;
  const lower = value.toLowerCase().trim();
  return lower === 'yes' || lower === 'true' || lower === '1';
}

// Get or create category
async function getOrCreateCategory(
  businessId: string,
  categoryName: string,
  categoryOrder: Map<string, number>
): Promise<string> {
  const { data: existing } = await supabase
    .from('menu_categories')
    .select('id')
    .eq('business_id', businessId)
    .eq('name', categoryName)
    .single();

  if (existing) {
    return existing.id;
  }

  const order = categoryOrder.get(categoryName) || categoryOrder.size + 1;
  categoryOrder.set(categoryName, order);

  const { data: newCategory, error } = await supabase
    .from('menu_categories')
    .insert({
      business_id: businessId,
      name: categoryName,
      display_order: order,
      is_active: true,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to create category ${categoryName}: ${error.message}`);
  }

  return newCategory.id;
}

// Process all add-on rows from the CSV
async function processAddOns(
  businessId: string,
  addOnRows: CSVMenuRow[],
  result: ImportResult
): Promise<Map<string, string>> {
  const addOnMap = new Map<string, string>();

  if (addOnRows.length === 0) return addOnMap;

  // Fetch existing add-ons for the business to decide between insert/update
  const { data: existingAddOns, error } = await supabase
    .from('add_ons')
    .select('id, name')
    .eq('business_id', businessId);

  if (error) {
    result.errors.push(`Could not fetch existing add-ons: ${error.message}`);
    return addOnMap;
  }

  const existingAddOnMap = new Map(existingAddOns.map(a => [a.name, a.id]));

  for (const row of addOnRows) {
    const price = parseFloat(row.price);
    if (isNaN(price)) {
      result.errors.push(`Invalid price for add-on "${row.item_name}"`);
      continue;
    }

    const addOnData = {
      business_id: businessId,
      name: row.item_name,
      price: price,
    };

    let addOnId = existingAddOnMap.get(row.item_name);

    if (addOnId) {
      // Update existing add-on
      const { error: updateError } = await supabase
        .from('add_ons')
        .update(addOnData)
        .eq('id', addOnId);

      if (updateError) {
        result.errors.push(`Failed to update add-on "${row.item_name}": ${updateError.message}`);
      } else {
        result.addOnsUpdated++;
        addOnMap.set(row.item_name, addOnId);
      }
    } else {
      // Create new add-on
      const { data: newAddOn, error: insertError } = await supabase
        .from('add_ons')
        .insert(addOnData)
        .select('id, name')
        .single();
        
      if (insertError) {
        result.errors.push(`Failed to create add-on "${row.item_name}": ${insertError.message}`);
      } else {
        result.addOnsCreated++;
        addOnMap.set(newAddOn.name, newAddOn.id);
        existingAddOnMap.set(newAddOn.name, newAddOn.id); // Add to map for future rows
      }
    }
  }

  // Add existing add-ons to the final map for linking
  existingAddOnMap.forEach((id, name) => {
    if (!addOnMap.has(name)) {
      addOnMap.set(name, id);
    }
  });

  return addOnMap;
}

// Link add-ons and related items to a menu item
async function linkRelations(
  menuItemId: string,
  row: CSVMenuRow,
  addOnMap: Map<string, string>,
  menuItemNameMap: Map<string, string>
) {
  // Link Add-ons
  if (row.available_add_ons) {
    await supabase.from('menu_item_add_ons').delete().eq('menu_item_id', menuItemId);

    const addOnNames = row.available_add_ons.split(',').map(name => name.trim()).filter(Boolean);
    const addOnLinks = [];

    for (const name of addOnNames) {
      const add_on_id = addOnMap.get(name);
      if (add_on_id) {
        addOnLinks.push({ menu_item_id: menuItemId, add_on_id });
      }
    }
    if (addOnLinks.length > 0) {
      await supabase.from('menu_item_add_ons').insert(addOnLinks);
    }
  }

  // Link Related Items
  if (row.related_items) {
    await supabase.from('menu_item_related_items').delete().eq('menu_item_id', menuItemId);

    const relatedItemNames = row.related_items.split(',').map(name => name.trim()).filter(Boolean);
    const relatedItemLinks = [];

    for (const name of relatedItemNames) {
      const related_item_id = menuItemNameMap.get(name);
      if (related_item_id && related_item_id !== menuItemId) {
        relatedItemLinks.push({ menu_item_id: menuItemId, related_item_id });
      }
    }
    if (relatedItemLinks.length > 0) {
      await supabase.from('menu_item_related_items').insert(relatedItemLinks);
    }
  }
}

// Import menu from CSV content
export async function importMenuFromCSV(
  businessId: string,
  csvContent: string,
  replaceExisting: boolean = false
): Promise<ImportResult> {
  const result: ImportResult = {
    success: false,
    categoriesCreated: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    addOnsCreated: 0,
    addOnsUpdated: 0,
    errors: [],
  };

  try {
    const rows = parseCSV(csvContent);
    if (rows.length === 0) {
      result.errors.push('No valid menu items found in CSV');
      return result;
    }

    if (replaceExisting) {
      // Clear all related data
      await supabase.from('menu_item_add_ons').delete().in('menu_item_id', (await supabase.from('menu_items').select('id').eq('business_id', businessId)).data?.map(i => i.id) || []);
      await supabase.from('menu_item_related_items').delete().in('menu_item_id', (await supabase.from('menu_items').select('id').eq('business_id', businessId)).data?.map(i => i.id) || []);
      await supabase.from('add_ons').delete().eq('business_id', businessId);
      await supabase.from('menu_items').delete().eq('business_id', businessId);
      await supabase.from('menu_categories').delete().eq('business_id', businessId);
      logger.info('Cleared existing menu data');
    }

    const addOnRows = rows.filter(r => r.category === ADDON_CATEGORY_NAME);
    const menuItemRows = rows.filter(r => r.category !== ADDON_CATEGORY_NAME);

    // Process add-ons first to create/update them
    const addOnMap = await processAddOns(businessId, addOnRows, result);
    logger.info(`Processed ${addOnMap.size} add-ons`);

    // --- Process Menu Items ---
    const categoryOrder = new Map<string, number>();
    const existingCategories = new Set<string>();
    const menuItemNameMap = new Map<string, string>();

    const { data: existingCats } = await supabase.from('menu_categories').select('name').eq('business_id', businessId);
    if (existingCats) existingCats.forEach(c => existingCategories.add(c.name));

    // For linking related items, we need a map of all potential item names to their IDs
    const { data: allItems } = await supabase.from('menu_items').select('id, name').eq('business_id', businessId);
    if (allItems) allItems.forEach(item => menuItemNameMap.set(item.name, item.id));

    for (let i = 0; i < menuItemRows.length; i++) {
      const row = menuItemRows[i];
      const rowNum = i + 2;

      try {
        if (!row.item_name) {
          result.errors.push(`Row ${rowNum}: Missing item name`);
          continue;
        }
        if (!row.category) {
          result.errors.push(`Row ${rowNum}: Missing category for "${row.item_name}"`);
          continue;
        }

        const wasNewCategory = !existingCategories.has(row.category);
        const categoryId = await getOrCreateCategory(businessId, row.category, categoryOrder);
        if (wasNewCategory) {
          existingCategories.add(row.category);
          result.categoriesCreated++;
        }

        const sizes = parseSizes(row.sizes);
        const price = row.price ? parseFloat(row.price) : null;

        const itemData = {
          business_id: businessId,
          category_id: categoryId,
          name: row.item_name,
          description: row.description || null,
          price: sizes ? null : price,
          sizes: sizes,
          is_customizable: parseBoolean(row.is_customizable),
          requires_date: parseBoolean(row.requires_date),
          special_notes: row.special_notes || null,
          is_available: true,
        };

        let menuItemId = menuItemNameMap.get(row.item_name);
        if (menuItemId) {
          const { error } = await supabase.from('menu_items').update(itemData).eq('id', menuItemId);
          if (error) {
            result.errors.push(`Row ${rowNum}: Failed to update "${row.item_name}": ${error.message}`);
          } else {
            result.itemsUpdated++;
            await linkRelations(menuItemId, row, addOnMap, menuItemNameMap);
          }
        } else {
          const { data: newItem, error } = await supabase.from('menu_items').insert(itemData).select('id, name').single();
          if (error) {
            result.errors.push(`Row ${rowNum}: Failed to create "${row.item_name}": ${error.message}`);
          } else {
            result.itemsCreated++;
            menuItemNameMap.set(newItem.name, newItem.id);
            await linkRelations(newItem.id, row, addOnMap, menuItemNameMap);
          }
        }
      } catch (rowError) {
        result.errors.push(`Row ${rowNum}: ${rowError instanceof Error ? rowError.message : 'Unknown error'}`);
      }
    }

    result.success = result.errors.length === 0;
    logger.info(`Import complete: ${result.itemsCreated} items created, ${result.itemsUpdated} items updated.`);
    if (result.errors.length > 0) logger.warn(`Import had ${result.errors.length} errors`);

  } catch (error) {
    result.errors.push(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    logger.error('Menu import failed', error);
  }

  return result;
}

// Export menu to CSV format
export async function exportMenuToCSV(businessId: string): Promise<string> {
  const { data: items, error } = await supabase
    .from('menu_items')
    .select(`
      *,
      category:menu_categories(name),
      add_ons:menu_item_add_ons(add_on:add_ons(name)),
      related_items:menu_item_related_items(related_item:menu_items(name))
    `)
    .eq('business_id', businessId)
    .order('category_id');

  if (error) {
    throw new Error(`Failed to fetch menu for export: ${error.message}`);
  }

  const { data: addOns, error: addOnError } = await supabase
    .from('add_ons')
    .select('*')
    .eq('business_id', businessId);
  
  if (addOnError) {
    throw new Error(`Failed to fetch add-ons for export: ${addOnError.message}`);
  }

  const headers = 'category,item_name,description,price,sizes,is_customizable,requires_date,special_notes,available_add_ons,related_items';
  const rows: string[] = [headers];

  // Add Add-on definitions first
  for (const addOn of addOns || []) {
    const row = [
      ADDON_CATEGORY_NAME,
      escapeCSV(addOn.name),
      '', // description
      addOn.price?.toString() || '0',
      '', // sizes
      'no', 'no', '', '', '' // booleans and relations
    ].join(',');
    rows.push(row);
  }

  // Add Menu items
  for (const item of items || []) {
    const categoryName = (item.category as any)?.name || '';
    const sizesStr = item.sizes ? (item.sizes as MenuItemSize[]).map(s => `${s.name}:${s.price}`).join('|') : '';
    // @ts-ignore
    const addOnsStr = item.add_ons?.map(a => a.add_on.name).join(',') || '';
    // @ts-ignore
    const relatedItemsStr = item.related_items?.map(r => r.related_item.name).join(',') || '';
    
    const row = [
      escapeCSV(categoryName),
      escapeCSV(item.name),
      escapeCSV(item.description || ''),
      item.price?.toString() || '',
      sizesStr,
      item.is_customizable ? 'yes' : 'no',
      item.requires_date ? 'yes' : 'no',
      escapeCSV((item as any).special_notes || ''),
      escapeCSV(addOnsStr),
      escapeCSV(relatedItemsStr),
    ].join(',');

    rows.push(row);
  }

  return rows.join('\n');
}

// Escape CSV field
function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Validate CSV format without importing
export function validateMenuCSV(csvContent: string): { valid: boolean; errors: string[]; rowCount: number } {
  const errors: string[] = [];

  try {
    const rows = parseCSV(csvContent);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;

      if (!row.item_name) {
        errors.push(`Row ${rowNum}: Missing item name`);
      }
      if (!row.category) {
        errors.push(`Row ${rowNum}: Missing category`);
      }
      if (row.sizes && !parseSizes(row.sizes)) {
        errors.push(`Row ${rowNum}: Invalid sizes format. Use "size:price|size:price"`);
      }
      if (row.category === ADDON_CATEGORY_NAME && !row.price) {
        errors.push(`Row ${rowNum}: Add-on "${row.item_name}" must have a price.`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      rowCount: rows.length,
    };
  } catch (error) {
    return {
      valid: false,
      errors: [`CSV parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
      rowCount: 0,
    };
  }
}
