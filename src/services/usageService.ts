/**
 * Usage Tracking Service
 * Tracks API usage for AI, WhatsApp, and Google Maps per business
 */

import { supabase } from '../config/database';
import { logger } from '../utils/logger';

// ============================================
// Types
// ============================================

export type APIType = 'ai' | 'whatsapp' | 'google_maps';
export type AIProvider = 'gemini' | 'openrouter' | 'groq';
export type MessageDirection = 'inbound' | 'outbound';
export type MessageType = 'text' | 'image' | 'document' | 'interactive' | 'location';

export interface AIUsageData {
  businessId: string;
  provider: AIProvider;
  tokensInput: number;
  tokensOutput: number;
  latencyMs: number;
  success: boolean;
  errorMessage?: string;
}

export interface WhatsAppUsageData {
  businessId: string;
  direction: MessageDirection;
  messageType: MessageType;
  success: boolean;
  errorMessage?: string;
}

export interface GoogleMapsUsageData {
  businessId: string;
  distanceMeters?: number;
  latencyMs: number;
  success: boolean;
  errorMessage?: string;
}

export interface UsageSummary {
  businessId: string;
  businessName: string;
  period: { from: string; to: string };
  ai: {
    totalRequests: number;
    tokensInput: number;
    tokensOutput: number;
    errorCount: number;
    avgLatencyMs: number;
    estimatedCostUsd: number;
  };
  whatsapp: {
    messagesReceived: number;
    messagesSent: number;
    mediaSent: number;
    estimatedCostUsd: number;
  };
  googleMaps: {
    apiCalls: number;
    estimatedCostUsd: number;
  };
  business: {
    ordersCount: number;
    revenue: number;
    uniqueCustomers: number;
  };
  totalCostUsd: number;
}

// ============================================
// Cost Configuration (cached)
// ============================================

interface CostConfig {
  ai: Record<string, { inputToken: number; outputToken: number }>;
  whatsapp: { perMessage: number };
  googleMaps: { perRequest: number };
}

let costConfigCache: CostConfig | null = null;
let costConfigLastFetch = 0;
const COST_CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function getCostConfig(): Promise<CostConfig> {
  const now = Date.now();
  if (costConfigCache && now - costConfigLastFetch < COST_CACHE_TTL) {
    return costConfigCache;
  }

  const { data } = await supabase
    .from('api_cost_config')
    .select('*')
    .is('effective_to', null);

  const config: CostConfig = {
    ai: {
      gemini: { inputToken: 0.0000001, outputToken: 0.0000004 },
      openrouter: { inputToken: 0.0000001, outputToken: 0.0000004 },
      groq: { inputToken: 0.0000001, outputToken: 0.0000004 },
    },
    whatsapp: { perMessage: 0.005 },
    googleMaps: { perRequest: 0.005 },
  };

  if (data) {
    for (const row of data) {
      if (row.api_type === 'ai' && row.provider) {
        config.ai[row.provider] = {
          inputToken: row.cost_per_input_token || 0,
          outputToken: row.cost_per_output_token || 0,
        };
      } else if (row.api_type === 'whatsapp') {
        config.whatsapp.perMessage = row.cost_per_message || 0.005;
      } else if (row.api_type === 'google_maps') {
        config.googleMaps.perRequest = row.cost_per_request || 0.005;
      }
    }
  }

  costConfigCache = config;
  costConfigLastFetch = now;
  return config;
}

// ============================================
// Tracking Functions
// ============================================

/**
 * Track AI API usage
 */
export async function trackAIUsage(data: AIUsageData): Promise<void> {
  try {
    const config = await getCostConfig();
    const providerConfig = config.ai[data.provider] || config.ai.gemini;

    const estimatedCost =
      data.tokensInput * providerConfig.inputToken +
      data.tokensOutput * providerConfig.outputToken;

    await supabase.from('api_usage_logs').insert({
      business_id: data.businessId,
      api_type: 'ai',
      provider: data.provider,
      tokens_input: data.tokensInput,
      tokens_output: data.tokensOutput,
      latency_ms: data.latencyMs,
      success: data.success,
      error_message: data.errorMessage,
      estimated_cost_usd: estimatedCost,
    });

    logger.debug(`Tracked AI usage: ${data.provider}, ${data.tokensInput}+${data.tokensOutput} tokens, $${estimatedCost.toFixed(6)}`);
  } catch (error) {
    logger.error('Failed to track AI usage', { error });
    // Don't throw - tracking should not break the main flow
  }
}

/**
 * Track WhatsApp message usage
 */
export async function trackWhatsAppUsage(data: WhatsAppUsageData): Promise<void> {
  try {
    const config = await getCostConfig();

    // Only count outbound messages for cost (simplified)
    const estimatedCost = data.direction === 'outbound' ? config.whatsapp.perMessage : 0;

    await supabase.from('api_usage_logs').insert({
      business_id: data.businessId,
      api_type: 'whatsapp',
      provider: 'meta',
      message_direction: data.direction,
      message_type: data.messageType,
      success: data.success,
      error_message: data.errorMessage,
      estimated_cost_usd: estimatedCost,
    });

    logger.debug(`Tracked WhatsApp: ${data.direction} ${data.messageType}`);
  } catch (error) {
    logger.error('Failed to track WhatsApp usage', { error });
  }
}

/**
 * Track Google Maps Distance Matrix API usage
 */
export async function trackGoogleMapsUsage(data: GoogleMapsUsageData): Promise<void> {
  try {
    const config = await getCostConfig();
    const estimatedCost = data.success ? config.googleMaps.perRequest : 0;

    await supabase.from('api_usage_logs').insert({
      business_id: data.businessId,
      api_type: 'google_maps',
      provider: 'distance_matrix',
      distance_meters: data.distanceMeters,
      latency_ms: data.latencyMs,
      success: data.success,
      error_message: data.errorMessage,
      estimated_cost_usd: estimatedCost,
    });

    logger.debug(`Tracked Google Maps API: ${data.distanceMeters}m, $${estimatedCost.toFixed(4)}`);
  } catch (error) {
    logger.error('Failed to track Google Maps usage', { error });
  }
}

// ============================================
// Query Functions (for Super Admin Dashboard)
// ============================================

/**
 * Get usage summary for a single business
 */
export async function getBusinessUsageSummary(
  businessId: string,
  fromDate: string,
  toDate: string
): Promise<UsageSummary | null> {
  try {
    // Get business name
    const { data: business } = await supabase
      .from('businesses')
      .select('name')
      .eq('id', businessId)
      .single();

    // If business doesn't exist, return null
    if (!business) {
      return null;
    }

    // Get daily stats
    const { data: stats } = await supabase
      .from('usage_daily_stats')
      .select('*')
      .eq('business_id', businessId)
      .gte('stat_date', fromDate)
      .lte('stat_date', toDate);

    // If no stats yet, return empty summary (business exists but no data)
    if (!stats || stats.length === 0) {
      return {
        businessId,
        businessName: business.name || 'Unknown',
        period: { from: fromDate, to: toDate },
        ai: {
          totalRequests: 0,
          tokensInput: 0,
          tokensOutput: 0,
          errorCount: 0,
          avgLatencyMs: 0,
          estimatedCostUsd: 0,
        },
        whatsapp: {
          messagesReceived: 0,
          messagesSent: 0,
          mediaSent: 0,
          estimatedCostUsd: 0,
        },
        googleMaps: {
          apiCalls: 0,
          estimatedCostUsd: 0,
        },
        business: {
          ordersCount: 0,
          revenue: 0,
          uniqueCustomers: 0,
        },
        totalCostUsd: 0,
      };
    }

    // Aggregate stats
    const summary: UsageSummary = {
      businessId,
      businessName: business?.name || 'Unknown',
      period: { from: fromDate, to: toDate },
      ai: {
        totalRequests: 0,
        tokensInput: 0,
        tokensOutput: 0,
        errorCount: 0,
        avgLatencyMs: 0,
        estimatedCostUsd: 0,
      },
      whatsapp: {
        messagesReceived: 0,
        messagesSent: 0,
        mediaSent: 0,
        estimatedCostUsd: 0,
      },
      googleMaps: {
        apiCalls: 0,
        estimatedCostUsd: 0,
      },
      business: {
        ordersCount: 0,
        revenue: 0,
        uniqueCustomers: 0,
      },
      totalCostUsd: 0,
    };

    let latencySum = 0;
    let latencyCount = 0;

    for (const stat of stats) {
      summary.ai.totalRequests += stat.ai_requests_count || 0;
      summary.ai.tokensInput += stat.ai_tokens_input || 0;
      summary.ai.tokensOutput += stat.ai_tokens_output || 0;
      summary.ai.errorCount += stat.ai_errors_count || 0;
      summary.ai.estimatedCostUsd += parseFloat(stat.ai_estimated_cost_usd) || 0;

      if (stat.ai_avg_latency_ms) {
        latencySum += stat.ai_avg_latency_ms * stat.ai_requests_count;
        latencyCount += stat.ai_requests_count;
      }

      summary.whatsapp.messagesReceived += stat.wa_messages_received || 0;
      summary.whatsapp.messagesSent += stat.wa_messages_sent || 0;
      summary.whatsapp.mediaSent += stat.wa_media_sent || 0;
      summary.whatsapp.estimatedCostUsd += parseFloat(stat.wa_estimated_cost_usd) || 0;

      summary.googleMaps.apiCalls += stat.maps_api_calls || 0;
      summary.googleMaps.estimatedCostUsd += parseFloat(stat.maps_estimated_cost_usd) || 0;

      summary.business.ordersCount += stat.orders_count || 0;
      summary.business.revenue += parseFloat(stat.orders_revenue) || 0;
      summary.business.uniqueCustomers += stat.unique_customers || 0;

      summary.totalCostUsd += parseFloat(stat.total_estimated_cost_usd) || 0;
    }

    summary.ai.avgLatencyMs = latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0;

    return summary;
  } catch (error) {
    logger.error('Failed to get business usage summary', { error, businessId });
    return null;
  }
}

/**
 * Get usage overview for all businesses (Super Admin)
 */
export async function getAllBusinessesUsageOverview(
  fromDate: string,
  toDate: string
): Promise<UsageSummary[]> {
  try {
    const { data: businesses } = await supabase
      .from('businesses')
      .select('id, name')
      .eq('is_active', true);

    if (!businesses) return [];

    const summaries: UsageSummary[] = [];

    for (const business of businesses) {
      const summary = await getBusinessUsageSummary(business.id, fromDate, toDate);
      if (summary) {
        summaries.push(summary);
      } else {
        // Return empty summary for businesses with no data
        summaries.push({
          businessId: business.id,
          businessName: business.name,
          period: { from: fromDate, to: toDate },
          ai: {
            totalRequests: 0,
            tokensInput: 0,
            tokensOutput: 0,
            errorCount: 0,
            avgLatencyMs: 0,
            estimatedCostUsd: 0,
          },
          whatsapp: {
            messagesReceived: 0,
            messagesSent: 0,
            mediaSent: 0,
            estimatedCostUsd: 0,
          },
          googleMaps: {
            apiCalls: 0,
            estimatedCostUsd: 0,
          },
          business: {
            ordersCount: 0,
            revenue: 0,
            uniqueCustomers: 0,
          },
          totalCostUsd: 0,
        });
      }
    }

    // Sort by total cost descending
    return summaries.sort((a, b) => b.totalCostUsd - a.totalCostUsd);
  } catch (error) {
    logger.error('Failed to get all businesses usage overview', { error });
    return [];
  }
}

/**
 * Get real-time usage stats (from raw logs for today)
 */
export async function getRealTimeUsage(businessId?: string): Promise<{
  aiCalls: number;
  whatsappMessages: number;
  mapsAPICalls: number;
  estimatedCostUsd: number;
}> {
  try {
    const today = new Date().toISOString().split('T')[0];

    let query = supabase
      .from('api_usage_logs')
      .select('api_type, estimated_cost_usd')
      .gte('created_at', today);

    if (businessId) {
      query = query.eq('business_id', businessId);
    }

    const { data } = await query;

    if (!data) {
      return { aiCalls: 0, whatsappMessages: 0, mapsAPICalls: 0, estimatedCostUsd: 0 };
    }

    const result = {
      aiCalls: 0,
      whatsappMessages: 0,
      mapsAPICalls: 0,
      estimatedCostUsd: 0,
    };

    for (const row of data) {
      result.estimatedCostUsd += parseFloat(row.estimated_cost_usd) || 0;

      switch (row.api_type) {
        case 'ai':
          result.aiCalls++;
          break;
        case 'whatsapp':
          result.whatsappMessages++;
          break;
        case 'google_maps':
          result.mapsAPICalls++;
          break;
      }
    }

    return result;
  } catch (error) {
    logger.error('Failed to get real-time usage', { error });
    return { aiCalls: 0, whatsappMessages: 0, mapsAPICalls: 0, estimatedCostUsd: 0 };
  }
}

/**
 * Get usage trends (daily breakdown for charts)
 */
export async function getUsageTrends(
  businessId: string | null,
  fromDate: string,
  toDate: string
): Promise<Array<{
  date: string;
  aiCalls: number;
  aiCost: number;
  whatsappMessages: number;
  whatsappCost: number;
  mapsCalls: number;
  mapsCost: number;
  totalCost: number;
}>> {
  try {
    let query = supabase
      .from('usage_daily_stats')
      .select('*')
      .gte('stat_date', fromDate)
      .lte('stat_date', toDate)
      .order('stat_date', { ascending: true });

    if (businessId) {
      query = query.eq('business_id', businessId);
    }

    const { data } = await query;

    if (!data) return [];

    // Group by date if no specific business
    const byDate: Record<string, {
      date: string;
      aiCalls: number;
      aiCost: number;
      whatsappMessages: number;
      whatsappCost: number;
      mapsCalls: number;
      mapsCost: number;
      totalCost: number;
    }> = {};

    for (const row of data) {
      const date = row.stat_date;
      if (!byDate[date]) {
        byDate[date] = {
          date,
          aiCalls: 0,
          aiCost: 0,
          whatsappMessages: 0,
          whatsappCost: 0,
          mapsCalls: 0,
          mapsCost: 0,
          totalCost: 0,
        };
      }

      byDate[date].aiCalls += row.ai_requests_count || 0;
      byDate[date].aiCost += parseFloat(row.ai_estimated_cost_usd) || 0;
      byDate[date].whatsappMessages += (row.wa_messages_received || 0) + (row.wa_messages_sent || 0);
      byDate[date].whatsappCost += parseFloat(row.wa_estimated_cost_usd) || 0;
      byDate[date].mapsCalls += row.maps_api_calls || 0;
      byDate[date].mapsCost += parseFloat(row.maps_estimated_cost_usd) || 0;
      byDate[date].totalCost += parseFloat(row.total_estimated_cost_usd) || 0;
    }

    return Object.values(byDate);
  } catch (error) {
    logger.error('Failed to get usage trends', { error });
    return [];
  }
}

/**
 * Get alerts for unusual usage patterns
 */
export async function getUsageAlerts(businessId?: string): Promise<Array<{
  type: 'spike' | 'high_error_rate' | 'approaching_limit' | 'inactive';
  severity: 'warning' | 'critical';
  message: string;
  businessId: string;
  businessName?: string;
}>> {
  const alerts: Array<{
    type: 'spike' | 'high_error_rate' | 'approaching_limit' | 'inactive';
    severity: 'warning' | 'critical';
    message: string;
    businessId: string;
    businessName?: string;
  }> = [];

  try {
    // Get last 7 days stats
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    let query = supabase
      .from('usage_daily_stats')
      .select('*, businesses(name)')
      .gte('stat_date', weekAgo.toISOString().split('T')[0])
      .order('stat_date', { ascending: false });

    if (businessId) {
      query = query.eq('business_id', businessId);
    }

    const { data } = await query;

    if (!data) return alerts;

    // Group by business
    const byBusiness: Record<string, typeof data> = {};
    for (const row of data) {
      if (!byBusiness[row.business_id]) {
        byBusiness[row.business_id] = [];
      }
      byBusiness[row.business_id].push(row);
    }

    for (const [bizId, stats] of Object.entries(byBusiness)) {
      if (stats.length < 2) continue;

      const latest = stats[0];
      const previous = stats.slice(1);
      const businessName = (latest as unknown as { businesses?: { name: string } }).businesses?.name;

      // Calculate averages
      const avgAICalls = previous.reduce((sum, s) => sum + (s.ai_requests_count || 0), 0) / previous.length;
      const avgErrors = previous.reduce((sum, s) => sum + (s.ai_errors_count || 0), 0) / previous.length;

      // Check for AI usage spike (>200% of average)
      if (avgAICalls > 0 && latest.ai_requests_count > avgAICalls * 2) {
        alerts.push({
          type: 'spike',
          severity: latest.ai_requests_count > avgAICalls * 3 ? 'critical' : 'warning',
          message: `AI usage spike: ${latest.ai_requests_count} calls (avg: ${Math.round(avgAICalls)})`,
          businessId: bizId,
          businessName,
        });
      }

      // Check for high error rate (>5%)
      const errorRate = latest.ai_requests_count > 0
        ? (latest.ai_errors_count || 0) / latest.ai_requests_count
        : 0;
      if (errorRate > 0.05) {
        alerts.push({
          type: 'high_error_rate',
          severity: errorRate > 0.1 ? 'critical' : 'warning',
          message: `High AI error rate: ${(errorRate * 100).toFixed(1)}%`,
          businessId: bizId,
          businessName,
        });
      }
    }

    return alerts;
  } catch (error) {
    logger.error('Failed to get usage alerts', { error });
    return alerts;
  }
}

/**
 * Aggregate daily stats (run via cron job)
 */
export async function aggregateDailyStats(date?: Date): Promise<void> {
  try {
    const targetDate = date || new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday
    const dateStr = targetDate.toISOString().split('T')[0];

    // Call the PostgreSQL function
    await supabase.rpc('aggregate_daily_usage_stats', { target_date: dateStr });

    logger.info(`Aggregated daily stats for ${dateStr}`);
  } catch (error) {
    logger.error('Failed to aggregate daily stats', { error });
  }
}

/**
 * Update order metrics in daily stats
 */
export async function updateOrderMetrics(
  businessId: string,
  date: Date,
  ordersCount: number,
  revenue: number,
  uniqueCustomers: number
): Promise<void> {
  try {
    const dateStr = date.toISOString().split('T')[0];

    await supabase
      .from('usage_daily_stats')
      .upsert({
        business_id: businessId,
        stat_date: dateStr,
        orders_count: ordersCount,
        orders_revenue: revenue,
        unique_customers: uniqueCustomers,
      }, {
        onConflict: 'business_id,stat_date',
      });
  } catch (error) {
    logger.error('Failed to update order metrics', { error });
  }
}
