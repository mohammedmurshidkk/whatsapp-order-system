import { IRouter, Router, Response } from 'express';
import {
  getBusinesses,
  getBusiness,
  createBusiness,
  updateBusiness,
  toggleBusinessStatus,
  addBusinessAdmin,
  deleteBusinessAdmin,
  getBusinessStats,
  getOverviewAnalytics,
  getWebhookStatus,
} from '../controllers/superadminController';
import { authMiddleware, superadminMiddleware, AuthRequest } from '../middleware/auth';
import {
  getAllBusinessesUsageOverview,
  getBusinessUsageSummary,
  getUsageTrends,
  getUsageAlerts,
  getRealTimeUsage,
  aggregateDailyStats,
} from '../services/usageService';
import { getAuditLogs, getAuditStats, auditFromRequest } from '../services/auditService';
import {
  getAllFeatureDefinitions,
  getBusinessFeaturesWithDefinitions,
  bulkUpdateFeatures,
} from '../services/featureService';
import {
  getClearableDataSummary,
  checkDependencies,
  clearData,
  getAvailableDataTypes,
} from '../services/dataClearService';
import { supabase } from '../config/database';
import { logger } from '../utils/logger';

const router: IRouter = Router();

// All routes require authentication + superadmin role
router.use(authMiddleware);
router.use(superadminMiddleware);

// Business routes
router.get('/businesses', getBusinesses);
router.get('/businesses/:id', getBusiness);
router.post('/businesses', createBusiness);
router.put('/businesses/:id', updateBusiness);
router.patch('/businesses/:id/toggle-status', toggleBusinessStatus);

// Business admin management
router.post('/businesses/:id/admins', addBusinessAdmin);
router.delete('/businesses/:id/admins/:adminId', deleteBusinessAdmin);

// Analytics & Stats (for Tech Provider dashboard)
router.get('/analytics/overview', getOverviewAnalytics);
router.get('/businesses/:id/stats', getBusinessStats);
router.get('/businesses/:id/webhook-status', getWebhookStatus);

// ============================================
// Usage Tracking APIs
// ============================================

/**
 * GET /api/superadmin/usage/dashboard
 * Get usage dashboard overview
 */
router.get('/usage/dashboard', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query;
    const toDate = (to as string) || new Date().toISOString().split('T')[0];
    const fromDate = (from as string) || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const businessSummaries = await getAllBusinessesUsageOverview(fromDate, toDate);
    const realTimeStats = await getRealTimeUsage();
    const alerts = await getUsageAlerts();

    const { count: totalBusinesses } = await supabase
      .from('businesses')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    const totals = {
      totalCostUsd: 0,
      totalAICalls: 0,
      totalWhatsAppMessages: 0,
      totalMapsCalls: 0,
      totalOrders: 0,
      totalRevenue: 0,
    };

    for (const summary of businessSummaries) {
      totals.totalCostUsd += summary.totalCostUsd;
      totals.totalAICalls += summary.ai.totalRequests;
      totals.totalWhatsAppMessages += summary.whatsapp.messagesReceived + summary.whatsapp.messagesSent;
      totals.totalMapsCalls += summary.googleMaps.apiCalls;
      totals.totalOrders += summary.business.ordersCount;
      totals.totalRevenue += summary.business.revenue;
    }

    res.json({
      period: { from: fromDate, to: toDate },
      totals,
      realTime: realTimeStats,
      alerts,
      totalBusinesses,
      businesses: businessSummaries,
    });
  } catch (error) {
    logger.error('Failed to get usage dashboard', { error });
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

/**
 * GET /api/superadmin/usage/overview
 * Get usage overview for all businesses
 */
router.get('/usage/overview', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query;

    const toDate = (to as string) || new Date().toISOString().split('T')[0];
    const fromDate = (from as string) || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const summaries = await getAllBusinessesUsageOverview(fromDate, toDate);

    res.json({
      period: { from: fromDate, to: toDate },
      businesses: summaries,
    });
  } catch (error) {
    logger.error('Failed to get usage overview', { error });
    res.status(500).json({ error: 'Failed to load usage data' });
  }
});

/**
 * GET /api/superadmin/usage/business/:businessId
 * Get detailed usage for a specific business
 */
router.get('/usage/business/:businessId', async (req: AuthRequest, res: Response) => {
  try {
    const { businessId } = req.params;
    const { from, to } = req.query;

    const toDate = (to as string) || new Date().toISOString().split('T')[0];
    const fromDate = (from as string) || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const summary = await getBusinessUsageSummary(businessId, fromDate, toDate);

    if (!summary) {
      return res.status(404).json({ error: 'Business not found or no usage data' });
    }

    const trends = await getUsageTrends(businessId, fromDate, toDate);
    const alerts = await getUsageAlerts(businessId);

    res.json({
      summary,
      trends,
      alerts,
    });
  } catch (error) {
    logger.error('Failed to get business usage', { error });
    res.status(500).json({ error: 'Failed to load usage data' });
  }
});

/**
 * GET /api/superadmin/usage/trends
 * Get usage trends for charts
 */
router.get('/usage/trends', async (req: AuthRequest, res: Response) => {
  try {
    const { businessId, from, to } = req.query;

    const toDate = (to as string) || new Date().toISOString().split('T')[0];
    const fromDate = (from as string) || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const trends = await getUsageTrends(
      (businessId as string) || null,
      fromDate,
      toDate
    );

    res.json({
      period: { from: fromDate, to: toDate },
      trends,
    });
  } catch (error) {
    logger.error('Failed to get usage trends', { error });
    res.status(500).json({ error: 'Failed to load trends' });
  }
});

/**
 * GET /api/superadmin/usage/alerts
 * Get all usage alerts
 */
router.get('/usage/alerts', async (req: AuthRequest, res: Response) => {
  try {
    const { businessId } = req.query;
    const alerts = await getUsageAlerts(businessId as string);
    res.json({ alerts });
  } catch (error) {
    logger.error('Failed to get usage alerts', { error });
    res.status(500).json({ error: 'Failed to load alerts' });
  }
});

/**
 * GET /api/superadmin/usage/realtime
 * Get real-time usage stats
 */
router.get('/usage/realtime', async (req: AuthRequest, res: Response) => {
  try {
    const { businessId } = req.query;
    const stats = await getRealTimeUsage(businessId as string);
    res.json(stats);
  } catch (error) {
    logger.error('Failed to get real-time usage', { error });
    res.status(500).json({ error: 'Failed to load real-time stats' });
  }
});

/**
 * GET /api/superadmin/usage/costs
 * Get cost breakdown by API type
 */
router.get('/usage/costs', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query;

    const toDate = (to as string) || new Date().toISOString().split('T')[0];
    const fromDate = (from as string) || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const { data: costConfig } = await supabase
      .from('api_cost_config')
      .select('*')
      .is('effective_to', null);

    const summaries = await getAllBusinessesUsageOverview(fromDate, toDate);

    const costsByApi = {
      ai: { totalCost: 0, totalCalls: 0, tokensInput: 0, tokensOutput: 0 },
      whatsapp: { totalCost: 0, totalMessages: 0, mediaCount: 0 },
      googleMaps: { totalCost: 0, totalCalls: 0 },
    };

    for (const summary of summaries) {
      costsByApi.ai.totalCost += summary.ai.estimatedCostUsd;
      costsByApi.ai.totalCalls += summary.ai.totalRequests;
      costsByApi.ai.tokensInput += summary.ai.tokensInput;
      costsByApi.ai.tokensOutput += summary.ai.tokensOutput;

      costsByApi.whatsapp.totalCost += summary.whatsapp.estimatedCostUsd;
      costsByApi.whatsapp.totalMessages += summary.whatsapp.messagesReceived + summary.whatsapp.messagesSent;
      costsByApi.whatsapp.mediaCount += summary.whatsapp.mediaSent;

      costsByApi.googleMaps.totalCost += summary.googleMaps.estimatedCostUsd;
      costsByApi.googleMaps.totalCalls += summary.googleMaps.apiCalls;
    }

    res.json({
      period: { from: fromDate, to: toDate },
      totalCost: costsByApi.ai.totalCost + costsByApi.whatsapp.totalCost + costsByApi.googleMaps.totalCost,
      breakdown: costsByApi,
      pricing: costConfig,
    });
  } catch (error) {
    logger.error('Failed to get cost breakdown', { error });
    res.status(500).json({ error: 'Failed to load costs' });
  }
});

/**
 * PUT /api/superadmin/usage/costs/config
 * Update API cost configuration
 */
router.put('/usage/costs/config', async (req: AuthRequest, res: Response) => {
  try {
    const { apiType, provider, costPerInputToken, costPerOutputToken, costPerRequest, costPerMessage } = req.body;

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (costPerInputToken !== undefined) updateData.cost_per_input_token = costPerInputToken;
    if (costPerOutputToken !== undefined) updateData.cost_per_output_token = costPerOutputToken;
    if (costPerRequest !== undefined) updateData.cost_per_request = costPerRequest;
    if (costPerMessage !== undefined) updateData.cost_per_message = costPerMessage;

    const { error } = await supabase
      .from('api_cost_config')
      .update(updateData)
      .eq('api_type', apiType)
      .eq('provider', provider);

    if (error) {
      return res.status(400).json({ error: 'Failed to update cost config' });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to update cost config', { error });
    res.status(500).json({ error: 'Failed to update config' });
  }
});

/**
 * POST /api/superadmin/usage/aggregate
 * Manually trigger daily stats aggregation
 */
router.post('/usage/aggregate', async (req: AuthRequest, res: Response) => {
  try {
    const { date } = req.body;
    const targetDate = date ? new Date(date) : undefined;
    await aggregateDailyStats(targetDate);
    res.json({ success: true, message: 'Aggregation completed' });
  } catch (error) {
    logger.error('Failed to aggregate stats', { error });
    res.status(500).json({ error: 'Aggregation failed' });
  }
});

/**
 * GET /api/superadmin/usage/raw-logs
 * Get raw API usage logs (for debugging)
 */
router.get('/usage/raw-logs', async (req: AuthRequest, res: Response) => {
  try {
    const { businessId, apiType, from, to, limit = 100 } = req.query;

    let query = supabase
      .from('api_usage_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Number(limit));

    if (businessId) query = query.eq('business_id', businessId);
    if (apiType) query = query.eq('api_type', apiType);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({ error: 'Failed to load logs' });
    }

    res.json({ logs: data });
  } catch (error) {
    logger.error('Failed to get raw logs', { error });
    res.status(500).json({ error: 'Failed to load logs' });
  }
});

// ============================================
// Audit Logs APIs
// ============================================

/**
 * GET /api/superadmin/audit-logs
 * Get audit logs with filtering
 */
router.get('/audit-logs', async (req: AuthRequest, res: Response) => {
  try {
    const {
      adminId,
      businessId,
      action,
      entityType,
      entityId,
      from,
      to,
      limit = '50',
      page = '1',
    } = req.query;

    const limitNum = parseInt(limit as string, 10);
    const pageNum = parseInt(page as string, 10);
    const offset = (pageNum - 1) * limitNum;

    const { logs, total } = await getAuditLogs({
      adminId: adminId as string,
      businessId: businessId as string,
      action: action as string,
      entityType: entityType as string,
      entityId: entityId as string,
      fromDate: from as string,
      toDate: to as string,
      limit: limitNum,
      offset,
    });

    res.json({
      logs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    logger.error('Failed to get audit logs', { error });
    res.status(500).json({ error: 'Failed to load audit logs' });
  }
});

/**
 * GET /api/superadmin/audit-logs/stats
 * Get audit log statistics
 */
router.get('/audit-logs/stats', async (req: AuthRequest, res: Response) => {
  try {
    const { businessId, days = '30' } = req.query;

    const stats = await getAuditStats(
      businessId as string,
      parseInt(days as string, 10)
    );

    res.json(stats);
  } catch (error) {
    logger.error('Failed to get audit stats', { error });
    res.status(500).json({ error: 'Failed to load audit stats' });
  }
});

// ============================================
// Feature Management APIs
// ============================================

/**
 * GET /api/superadmin/feature-definitions
 * Get all available feature definitions
 */
router.get('/feature-definitions', async (req: AuthRequest, res: Response) => {
  try {
    const definitions = await getAllFeatureDefinitions();
    res.json({ definitions });
  } catch (error) {
    logger.error('Failed to get feature definitions', { error });
    res.status(500).json({ error: 'Failed to load feature definitions' });
  }
});

/**
 * GET /api/superadmin/businesses/:id/features
 * Get features for a specific business
 */
router.get('/businesses/:id/features', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const features = await getBusinessFeaturesWithDefinitions(id);
    res.json({ features });
  } catch (error) {
    logger.error('Failed to get business features', { error });
    res.status(500).json({ error: 'Failed to load business features' });
  }
});

/**
 * PUT /api/superadmin/businesses/:id/features
 * Update features for a business
 */
router.put('/businesses/:id/features', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { features } = req.body;
    const adminId = req.user?.id;

    if (!adminId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!features || !Array.isArray(features)) {
      return res.status(400).json({ error: 'features array is required' });
    }

    const updated = await bulkUpdateFeatures(id, features, adminId);
    res.json({ success: true, updated });
  } catch (error) {
    logger.error('Failed to update business features', { error });
    res.status(500).json({ error: 'Failed to update features' });
  }
});

// ============================================
// Data Clear APIs
// ============================================

/**
 * GET /api/superadmin/data-types
 * Get available data types for clearing
 */
router.get('/data-types', async (req: AuthRequest, res: Response) => {
  try {
    const dataTypes = getAvailableDataTypes();
    res.json({ dataTypes });
  } catch (error) {
    logger.error('Failed to get data types', { error });
    res.status(500).json({ error: 'Failed to load data types' });
  }
});

/**
 * GET /api/superadmin/businesses/:id/data-summary
 * Get data summary (counts) for a business
 */
router.get('/businesses/:id/data-summary', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const summary = await getClearableDataSummary(id);
    res.json({ summary });
  } catch (error) {
    logger.error('Failed to get data summary', { error });
    res.status(500).json({ error: 'Failed to load data summary' });
  }
});

/**
 * POST /api/superadmin/businesses/:id/data-clear/check
 * Check if a data type can be cleared (dependency check)
 */
router.post('/businesses/:id/data-clear/check', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { dataType } = req.body;

    if (!dataType) {
      return res.status(400).json({ error: 'dataType is required' });
    }

    const result = await checkDependencies(id, dataType);
    res.json(result);
  } catch (error) {
    logger.error('Failed to check dependencies', { error });
    res.status(500).json({ error: 'Failed to check dependencies' });
  }
});

/**
 * POST /api/superadmin/businesses/:id/data-clear
 * Clear data for a business (with confirmation)
 */
router.post('/businesses/:id/data-clear', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { dataType, confirm } = req.body;
    const adminId = req.user?.id;
    const adminEmail = req.user?.email;

    if (!adminId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!dataType) {
      return res.status(400).json({ error: 'dataType is required' });
    }

    if (confirm !== true) {
      return res.status(400).json({ error: 'confirm must be true to proceed with deletion' });
    }

    const result = await clearData(id, dataType, adminId, adminEmail);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error) {
    logger.error('Failed to clear data', { error });
    res.status(500).json({ error: 'Failed to clear data' });
  }
});

export default router;
