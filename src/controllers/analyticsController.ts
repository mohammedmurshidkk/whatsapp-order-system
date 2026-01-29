import { Response } from 'express';
import { AuthRequest, getBusinessId } from '../middleware/auth';
import { analyticsService } from '../services/analyticsService';
import { logger } from '../utils/logger';

/**
 * GET /api/analytics/summary
 */
export async function getSummary(req: AuthRequest, res: Response): Promise<void> {
    try {
        const businessId = getBusinessId(req);
        if (!businessId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { from, to } = req.query;

        // Default to last 30 days if not provided
        const toDate = to ? String(to) : new Date().toISOString().split('T')[0];
        const fromDate = from ? String(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const summary = await analyticsService.getSummary(businessId, fromDate, toDate);
        res.status(200).json({ summary });
    } catch (error) {
        logger.error('Controller: Failed to get analytics summary', error);
        res.status(500).json({ error: 'Failed to fetch analytics summary' });
    }
}

/**
 * GET /api/analytics/trends
 */
export async function getTrends(req: AuthRequest, res: Response): Promise<void> {
    try {
        const businessId = getBusinessId(req);
        if (!businessId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { from, to, granularity } = req.query;

        const toDate = to ? String(to) : new Date().toISOString().split('T')[0];
        const fromDate = from ? String(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const gran = (granularity as 'daily' | 'weekly' | 'monthly') || 'daily';

        const trends = await analyticsService.getTrends(businessId, fromDate, toDate, gran);
        res.status(200).json({ trends });
    } catch (error) {
        logger.error('Controller: Failed to get analytics trends', error);
        res.status(500).json({ error: 'Failed to fetch analytics trends' });
    }
}

/**
 * GET /api/analytics/top-customers
 */
export async function getTopCustomers(req: AuthRequest, res: Response): Promise<void> {
    try {
        const businessId = getBusinessId(req);
        if (!businessId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { limit } = req.query;
        const l = limit ? parseInt(String(limit), 10) : 10;

        const topCustomers = await analyticsService.getTopCustomers(businessId, l);
        res.status(200).json({ topCustomers });
    } catch (error) {
        logger.error('Controller: Failed to get top customers', error);
        res.status(500).json({ error: 'Failed to fetch top customers' });
    }
}

/**
 * GET /api/analytics/realtime
 */
export async function getRealtime(req: AuthRequest, res: Response): Promise<void> {
    try {
        const businessId = getBusinessId(req);
        if (!businessId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const realtime = await analyticsService.getRealtimeMetrics(businessId);
        res.status(200).json(realtime);
    } catch (error) {
        logger.error('Controller: Failed to get real-time metrics', error);
        res.status(500).json({ error: 'Failed to fetch real-time metrics' });
    }
}

/**
 * POST /api/analytics/refresh (Manual refresh for testing/admin)
 */
export async function refresh(req: AuthRequest, res: Response): Promise<void> {
    try {
        // Optional: add superadmin check here
        await analyticsService.refreshViews();
        res.status(200).json({ success: true, message: 'Analytics views refreshed' });
    } catch (error) {
        logger.error('Controller: Failed to refresh analytics views', error);
        res.status(500).json({ error: 'Failed to refresh analytics' });
    }
}
