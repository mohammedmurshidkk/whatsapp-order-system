/**
 * Audit Service
 * Logs admin/superadmin actions for accountability and debugging
 */

import { Request } from 'express';
import { supabase } from '../config/database';
import { logger } from '../utils/logger';

// Action types for type safety
export type AuditAction =
  // Superadmin - Business management
  | 'business.create'
  | 'business.update'
  | 'business.toggle_status'
  | 'business.admin_add'
  | 'business.admin_delete'
  // Superadmin - Usage/Config
  | 'usage.config_update'
  | 'usage.aggregate_trigger'
  // Admin - Menu
  | 'menu.item_create'
  | 'menu.item_update'
  | 'menu.item_delete'
  | 'menu.category_create'
  | 'menu.category_update'
  | 'menu.category_delete'
  | 'menu.addon_create'
  | 'menu.addon_update'
  | 'menu.addon_delete'
  // Admin - Orders
  | 'order.status_change'
  | 'order.cancel'
  // Admin - Sessions
  | 'session.ai_pause'
  | 'session.ai_resume'
  // Admin - Business settings
  | 'business.settings_update'
  // Admin - Interventions
  | 'intervention.respond'
  // Auth
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout';

export type EntityType =
  | 'business'
  | 'admin_user'
  | 'menu_item'
  | 'menu_category'
  | 'menu_addon'
  | 'order'
  | 'session'
  | 'intervention'
  | 'api_config';

export interface AuditLogEntry {
  adminId?: string;
  adminEmail?: string;
  adminRole?: string;
  action: AuditAction;
  entityType?: EntityType;
  entityId?: string;
  businessId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Extract request metadata for audit logging
 */
export function getRequestMetadata(req: Request): { ipAddress: string; userAgent: string } {
  const ipAddress =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.ip ||
    req.socket.remoteAddress ||
    'unknown';

  const userAgent = req.headers['user-agent'] || 'unknown';

  return { ipAddress, userAgent };
}

/**
 * Create an audit log entry
 */
export async function createAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const { error } = await supabase.from('audit_logs').insert({
      admin_id: entry.adminId || null,
      admin_email: entry.adminEmail || null,
      admin_role: entry.adminRole || null,
      action: entry.action,
      entity_type: entry.entityType || null,
      entity_id: entry.entityId || null,
      business_id: entry.businessId || null,
      details: entry.details || {},
      ip_address: entry.ipAddress || null,
      user_agent: entry.userAgent || null,
    });

    if (error) {
      logger.error('Failed to create audit log', { error, entry });
    }
  } catch (error) {
    // Don't throw - audit logging should not break the main flow
    logger.error('Audit logging error', { error, entry });
  }
}

/**
 * Helper to create audit log from authenticated request
 */
export async function auditFromRequest(
  req: Request & { adminUser?: { id: string; email: string; role: string; business_id?: string } },
  action: AuditAction,
  options: {
    entityType?: EntityType;
    entityId?: string;
    businessId?: string;
    details?: Record<string, unknown>;
  } = {}
): Promise<void> {
  const { ipAddress, userAgent } = getRequestMetadata(req);

  await createAuditLog({
    adminId: req.adminUser?.id,
    adminEmail: req.adminUser?.email,
    adminRole: req.adminUser?.role,
    action,
    entityType: options.entityType,
    entityId: options.entityId,
    businessId: options.businessId || req.adminUser?.business_id,
    details: options.details,
    ipAddress,
    userAgent,
  });
}

/**
 * Query audit logs with filters
 */
export interface AuditLogFilters {
  adminId?: string;
  businessId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

export interface AuditLogRecord {
  id: string;
  admin_id: string | null;
  admin_email: string | null;
  admin_role: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  business_id: string | null;
  details: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export async function getAuditLogs(
  filters: AuditLogFilters
): Promise<{ logs: AuditLogRecord[]; total: number }> {
  try {
    let query = supabase
      .from('audit_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (filters.adminId) {
      query = query.eq('admin_id', filters.adminId);
    }
    if (filters.businessId) {
      query = query.eq('business_id', filters.businessId);
    }
    if (filters.action) {
      query = query.ilike('action', `%${filters.action}%`);
    }
    if (filters.entityType) {
      query = query.eq('entity_type', filters.entityType);
    }
    if (filters.entityId) {
      query = query.eq('entity_id', filters.entityId);
    }
    if (filters.fromDate) {
      query = query.gte('created_at', filters.fromDate);
    }
    if (filters.toDate) {
      query = query.lte('created_at', filters.toDate);
    }

    const limit = filters.limit || 50;
    const offset = filters.offset || 0;
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      logger.error('Failed to fetch audit logs', { error, filters });
      return { logs: [], total: 0 };
    }

    return { logs: data || [], total: count || 0 };
  } catch (error) {
    logger.error('Error fetching audit logs', { error });
    return { logs: [], total: 0 };
  }
}

/**
 * Get audit log statistics
 */
export async function getAuditStats(
  businessId?: string,
  days: number = 30
): Promise<{
  totalActions: number;
  actionsByType: Record<string, number>;
  topAdmins: Array<{ email: string; count: number }>;
}> {
  try {
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    let query = supabase
      .from('audit_logs')
      .select('action, admin_email')
      .gte('created_at', fromDate);

    if (businessId) {
      query = query.eq('business_id', businessId);
    }

    const { data, error } = await query;

    if (error || !data) {
      return { totalActions: 0, actionsByType: {}, topAdmins: [] };
    }

    // Count actions by type
    const actionsByType: Record<string, number> = {};
    const adminCounts: Record<string, number> = {};

    for (const log of data) {
      actionsByType[log.action] = (actionsByType[log.action] || 0) + 1;
      if (log.admin_email) {
        adminCounts[log.admin_email] = (adminCounts[log.admin_email] || 0) + 1;
      }
    }

    // Get top admins
    const topAdmins = Object.entries(adminCounts)
      .map(([email, count]) => ({ email, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalActions: data.length,
      actionsByType,
      topAdmins,
    };
  } catch (error) {
    logger.error('Error fetching audit stats', { error });
    return { totalActions: 0, actionsByType: {}, topAdmins: [] };
  }
}
