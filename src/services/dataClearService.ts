/**
 * Data Clear Service
 * Handles clearing tenant data with dependency checking and audit logging
 */

import { supabase } from '../config/database';
import { logger } from '../utils/logger';
import { createAuditLog, AuditLogEntry } from './auditService';

export interface DataSummary {
  data_type: string;
  display_name: string;
  count: number;
  table_name: string;
}

export interface DependencyCheck {
  can_clear: boolean;
  blocked_by: Array<{ table: string; display_name: string; count: number }>;
}

export interface DataClearResult {
  success: boolean;
  deleted_count: number;
  errors?: string[];
}

// Data type configurations with their dependencies
const DATA_TYPES: Record<
  string,
  {
    table: string;
    display_name: string;
    dependencies: Array<{
      table: string;
      display_name: string;
      fk_column: string;
      source_column: string;
    }>;
  }
> = {
  messages: {
    table: 'messages',
    display_name: 'Chat Messages',
    dependencies: [],
  },
  session_item_addons: {
    table: 'session_item_addons',
    display_name: 'Session Item Add-ons',
    dependencies: [],
  },
  session_items: {
    table: 'session_items',
    display_name: 'Session Items (Cart)',
    dependencies: [
      {
        table: 'session_item_addons',
        display_name: 'Session Item Add-ons',
        fk_column: 'session_item_id',
        source_column: 'id',
      },
    ],
  },
  orders: {
    table: 'orders',
    display_name: 'Orders',
    dependencies: [],
  },
  sessions: {
    table: 'sessions',
    display_name: 'Chat Sessions',
    dependencies: [
      { table: 'messages', display_name: 'Chat Messages', fk_column: 'session_id', source_column: 'id' },
      { table: 'session_items', display_name: 'Session Items', fk_column: 'session_id', source_column: 'id' },
      { table: 'orders', display_name: 'Orders', fk_column: 'session_id', source_column: 'id' },
    ],
  },
  customer_profiles: {
    table: 'customer_profiles',
    display_name: 'Customer Profiles (CRM)',
    dependencies: [],
  },
  customers: {
    table: 'customers',
    display_name: 'Customers',
    dependencies: [
      { table: 'sessions', display_name: 'Sessions', fk_column: 'customer_id', source_column: 'id' },
      { table: 'customer_profiles', display_name: 'Customer Profiles', fk_column: 'customer_id', source_column: 'id' },
    ],
  },
  campaigns: {
    table: 'campaigns',
    display_name: 'Marketing Campaigns',
    dependencies: [
      { table: 'campaign_messages', display_name: 'Campaign Messages', fk_column: 'campaign_id', source_column: 'id' },
    ],
  },
  campaign_messages: {
    table: 'campaign_messages',
    display_name: 'Campaign Messages',
    dependencies: [],
  },
  notifications: {
    table: 'notifications',
    display_name: 'Notifications',
    dependencies: [],
  },
  interventions: {
    table: 'admin_intervention_requests',
    display_name: 'AI Interventions',
    dependencies: [],
  },
  cake_price_quotes: {
    table: 'cake_price_quotes',
    display_name: 'Cake Price Quotes',
    dependencies: [],
  },
  analytics: {
    table: 'mv_daily_order_metrics',
    display_name: 'Analytics Data',
    dependencies: [],
  },
  // Menu management data types
  category_addons: {
    table: 'category_addons',
    display_name: 'Category Add-on Links',
    dependencies: [],
  },
  menu_addons: {
    table: 'menu_addons',
    display_name: 'Menu Add-ons',
    dependencies: [
      {
        table: 'category_addons',
        display_name: 'Category Add-on Links',
        fk_column: 'addon_id',
        source_column: 'id',
      },
      {
        table: 'session_item_addons',
        display_name: 'Session Item Add-ons',
        fk_column: 'addon_id',
        source_column: 'id',
      },
    ],
  },
  menu_items: {
    table: 'menu_items',
    display_name: 'Menu Items',
    dependencies: [
      {
        table: 'session_items',
        display_name: 'Session Items',
        fk_column: 'menu_item_id',
        source_column: 'id',
      },
    ],
  },
  menu_categories: {
    table: 'menu_categories',
    display_name: 'Menu Categories',
    dependencies: [
      {
        table: 'menu_items',
        display_name: 'Menu Items',
        fk_column: 'category_id',
        source_column: 'id',
      },
      {
        table: 'category_addons',
        display_name: 'Category Add-on Links',
        fk_column: 'category_id',
        source_column: 'id',
      },
    ],
  },
};

/**
 * Get data summary for a business (counts per data type)
 */
export async function getClearableDataSummary(businessId: string): Promise<DataSummary[]> {
  const summaries: DataSummary[] = [];

  for (const [dataType, config] of Object.entries(DATA_TYPES)) {
    try {
      const { count, error } = await supabase
        .from(config.table)
        .select('*', { count: 'exact', head: true })
        .eq('business_id', businessId);

      if (error) {
        logger.warn(`Failed to count ${config.table}`, { error, businessId });
        continue;
      }

      summaries.push({
        data_type: dataType,
        display_name: config.display_name,
        count: count || 0,
        table_name: config.table,
      });
    } catch (err) {
      logger.warn(`Error counting ${config.table}`, { err, businessId });
    }
  }

  return summaries;
}

/**
 * Check if data type can be cleared (dependency check)
 */
export async function checkDependencies(
  businessId: string,
  dataType: string
): Promise<DependencyCheck> {
  const config = DATA_TYPES[dataType];

  if (!config) {
    return { can_clear: false, blocked_by: [{ table: 'unknown', display_name: 'Unknown data type', count: 0 }] };
  }

  const blockedBy: Array<{ table: string; display_name: string; count: number }> = [];

  for (const dep of config.dependencies) {
    // Get IDs from the source table for this business
    const { data: sourceIds, error: sourceError } = await supabase
      .from(config.table)
      .select(config.dependencies.length > 0 ? 'id' : '*')
      .eq('business_id', businessId);

    if (sourceError || !sourceIds || sourceIds.length === 0) {
      continue;
    }

    const ids = sourceIds.map((row) => row.id);

    // Check if dependency table has records referencing these IDs
    const { count, error } = await supabase
      .from(dep.table)
      .select('*', { count: 'exact', head: true })
      .in(dep.fk_column, ids);

    if (error) {
      logger.warn(`Failed to check dependency ${dep.table}`, { error });
      continue;
    }

    if (count && count > 0) {
      blockedBy.push({
        table: dep.table,
        display_name: dep.display_name,
        count,
      });
    }
  }

  return {
    can_clear: blockedBy.length === 0,
    blocked_by: blockedBy,
  };
}

/**
 * Clear data for a business
 */
export async function clearData(
  businessId: string,
  dataType: string,
  adminId: string,
  adminEmail?: string
): Promise<DataClearResult> {
  const config = DATA_TYPES[dataType];

  if (!config) {
    return { success: false, deleted_count: 0, errors: ['Unknown data type'] };
  }

  // First check dependencies
  const depCheck = await checkDependencies(businessId, dataType);
  if (!depCheck.can_clear) {
    const blockerNames = depCheck.blocked_by.map((b) => `${b.display_name} (${b.count})`).join(', ');
    return {
      success: false,
      deleted_count: 0,
      errors: [`Cannot clear: blocked by ${blockerNames}. Clear those first.`],
    };
  }

  // Get count before delete
  const { count: beforeCount } = await supabase
    .from(config.table)
    .select('*', { count: 'exact', head: true })
    .eq('business_id', businessId);

  // Perform delete
  const { error } = await supabase.from(config.table).delete().eq('business_id', businessId);

  if (error) {
    logger.error('Failed to clear data', { error, businessId, dataType });
    return { success: false, deleted_count: 0, errors: [error.message] };
  }

  const deletedCount = beforeCount || 0;

  // Log to audit
  const auditEntry: AuditLogEntry = {
    adminId,
    adminEmail,
    adminRole: 'superadmin',
    action: 'business.settings_update' as const, // Using existing action type
    entityType: 'business',
    entityId: businessId,
    businessId,
    details: {
      operation: 'data_clear',
      data_type: dataType,
      table: config.table,
      deleted_count: deletedCount,
    },
  };

  await createAuditLog(auditEntry);

  logger.info('Data cleared', {
    businessId,
    dataType,
    table: config.table,
    deletedCount,
    adminId,
  });

  return { success: true, deleted_count: deletedCount };
}

/**
 * Get available data types for clearing
 */
export function getAvailableDataTypes(): Array<{
  data_type: string;
  display_name: string;
  has_dependencies: boolean;
}> {
  return Object.entries(DATA_TYPES).map(([key, config]) => ({
    data_type: key,
    display_name: config.display_name,
    has_dependencies: config.dependencies.length > 0,
  }));
}
