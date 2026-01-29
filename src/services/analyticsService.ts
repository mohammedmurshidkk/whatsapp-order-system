import { supabase } from '../config/database';
import { logger } from '../utils/logger';
import { AnalyticsSummary, AnalyticsTrend, TopCustomer } from '../types';

export class AnalyticsService {
    /**
     * Get analytics summary for a date range
     */
    async getSummary(businessId: string, fromDate: string, toDate: string): Promise<AnalyticsSummary> {
        try {
            const { data, error } = await supabase.rpc('get_analytics_summary', {
                p_business_id: businessId,
                p_from_date: fromDate,
                p_to_date: toDate
            });

            if (error) throw error;
            return data as AnalyticsSummary;
        } catch (error) {
            logger.error('Failed to get analytics summary', { error, businessId, fromDate, toDate });
            throw error;
        }
    }

    /**
     * Get analytics trends for a date range and granularity
     */
    async getTrends(
        businessId: string,
        fromDate: string,
        toDate: string,
        granularity: 'daily' | 'weekly' | 'monthly' = 'daily'
    ): Promise<AnalyticsTrend[]> {
        try {
            const { data, error } = await supabase.rpc('get_analytics_trends', {
                p_business_id: businessId,
                p_from_date: fromDate,
                p_to_date: toDate,
                p_granularity: granularity
            });

            if (error) throw error;
            return data as AnalyticsTrend[];
        } catch (error) {
            logger.error('Failed to get analytics trends', { error, businessId, fromDate, toDate, granularity });
            throw error;
        }
    }

    /**
     * Get top customers for a business
     */
    async getTopCustomers(businessId: string, limit: number = 10): Promise<TopCustomer[]> {
        try {
            const { data, error } = await supabase.rpc('get_top_customers', {
                p_business_id: businessId,
                p_limit: limit
            });

            if (error) throw error;
            return data as TopCustomer[];
        } catch (error) {
            logger.error('Failed to get top customers', { error, businessId, limit });
            throw error;
        }
    }

    /**
     * Get real-time metrics (today's live stats)
     */
    async getRealtimeMetrics(businessId: string) {
        try {
            const today = new Date().toISOString().split('T')[0];

            // Get today's stats from materialized views (or direct query if not refreshed)
            const { data, error } = await supabase
                .from('mv_daily_order_metrics')
                .select('*')
                .eq('business_id', businessId)
                .eq('date', today)
                .single();

            // Also get active sessions
            const { count: activeSessions } = await supabase
                .from('sessions')
                .select('*', { count: 'exact', head: true })
                .eq('business_id', businessId)
                .eq('status', 'active');

            return {
                today_stats: data || {},
                active_sessions: activeSessions || 0
            };
        } catch (error) {
            logger.error('Failed to get real-time metrics', { error, businessId });
            throw error;
        }
    }

    /**
     * Manual refresh of analytics views
     */
    async refreshViews(): Promise<void> {
        try {
            const { error } = await supabase.rpc('refresh_analytics_views');
            if (error) throw error;
            logger.info('Analytics materialised views refreshed successfully');
        } catch (error) {
            logger.error('Failed to refresh analytics views', error);
            throw error;
        }
    }
}

export const analyticsService = new AnalyticsService();
