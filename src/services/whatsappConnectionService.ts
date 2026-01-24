/**
 * WhatsApp Connection Service
 * Manages per-business WhatsApp credentials for multi-tenant support
 */

import { supabase } from '../config/database';
import { logger } from '../utils/logger';

// Connection cache (5 min TTL)
const connectionCache = new Map<string, { connection: WhatsAppConnection; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface WhatsAppConnection {
  id: string;
  business_id: string;
  provider: 'meta' | 'webjs';
  phone_number: string;
  meta_phone_number_id: string | null;
  meta_access_token: string | null;
  meta_business_account_id: string | null;
  meta_webhook_secret: string | null;
  meta_verify_token: string | null;
  webjs_session_data: Record<string, unknown> | null;
  status: 'pending' | 'active' | 'disconnected';
  connected_at: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MetaCredentials {
  phoneNumberId: string;
  accessToken: string;
  businessAccountId?: string;
  webhookSecret?: string;
  verifyToken?: string;
}

/**
 * Get connection by business ID (with caching)
 */
export async function getConnectionByBusinessId(businessId: string): Promise<WhatsAppConnection | null> {
  // Check cache first
  const cacheKey = `business:${businessId}`;
  const cached = connectionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.connection;
  }

  try {
    const { data, error } = await supabase
      .from('whatsapp_connections')
      .select('*')
      .eq('business_id', businessId)
      .eq('status', 'active')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows found - fall back to env vars
        return null;
      }
      logger.error('Error fetching WhatsApp connection by business', { businessId, error });
      return null;
    }

    // Cache the result
    connectionCache.set(cacheKey, {
      connection: data,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return data;
  } catch (error) {
    logger.error('Error in getConnectionByBusinessId', { businessId, error });
    return null;
  }
}

/**
 * Get connection by phone number (for webhook routing)
 */
export async function getConnectionByPhone(phoneNumber: string): Promise<WhatsAppConnection | null> {
  // Normalize phone number (remove + and spaces)
  const normalizedPhone = phoneNumber.replace(/[\s+]/g, '');

  // Check cache first
  const cacheKey = `phone:${normalizedPhone}`;
  const cached = connectionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.connection;
  }

  try {
    const { data, error } = await supabase
      .from('whatsapp_connections')
      .select('*')
      .eq('phone_number', normalizedPhone)
      .eq('status', 'active')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      logger.error('Error fetching WhatsApp connection by phone', { phoneNumber, error });
      return null;
    }

    // Cache the result
    connectionCache.set(cacheKey, {
      connection: data,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return data;
  } catch (error) {
    logger.error('Error in getConnectionByPhone', { phoneNumber, error });
    return null;
  }
}

/**
 * Get Meta credentials for a business
 * Falls back to environment variables if no DB connection exists
 */
export async function getMetaCredentials(businessId?: string): Promise<MetaCredentials | null> {
  // If businessId provided, try to get from DB first
  if (businessId) {
    const connection = await getConnectionByBusinessId(businessId);
    if (connection && connection.provider === 'meta') {
      if (connection.meta_phone_number_id && connection.meta_access_token) {
        return {
          phoneNumberId: connection.meta_phone_number_id,
          accessToken: connection.meta_access_token,
          businessAccountId: connection.meta_business_account_id || undefined,
          webhookSecret: connection.meta_webhook_secret || undefined,
          verifyToken: connection.meta_verify_token || undefined,
        };
      }
    }
  }

  // Fall back to environment variables (backward compatibility)
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    return null;
  }

  return {
    phoneNumberId,
    accessToken,
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    webhookSecret: process.env.WHATSAPP_WEBHOOK_SECRET,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
  };
}

/**
 * Update last_message_at timestamp for a connection
 */
export async function updateLastMessageTime(businessId: string): Promise<void> {
  try {
    await supabase
      .from('whatsapp_connections')
      .update({ last_message_at: new Date().toISOString() })
      .eq('business_id', businessId);
  } catch (error) {
    // Non-critical, just log
    logger.debug('Failed to update last_message_at', { businessId, error });
  }
}

/**
 * Create or update a WhatsApp connection for a business
 */
export async function upsertConnection(
  businessId: string,
  connection: Partial<Omit<WhatsAppConnection, 'id' | 'business_id' | 'created_at' | 'updated_at'>>
): Promise<WhatsAppConnection | null> {
  try {
    const { data, error } = await supabase
      .from('whatsapp_connections')
      .upsert(
        {
          business_id: businessId,
          ...connection,
        },
        {
          onConflict: 'business_id',
        }
      )
      .select()
      .single();

    if (error) {
      logger.error('Error upserting WhatsApp connection', { businessId, error });
      return null;
    }

    // Invalidate cache
    clearConnectionCache(businessId);

    return data;
  } catch (error) {
    logger.error('Error in upsertConnection', { businessId, error });
    return null;
  }
}

/**
 * Clear connection cache for a business
 */
export function clearConnectionCache(businessId?: string): void {
  if (businessId) {
    // Clear specific business cache
    for (const [key] of connectionCache) {
      if (key.includes(businessId)) {
        connectionCache.delete(key);
      }
    }
  } else {
    // Clear all cache
    connectionCache.clear();
  }
}

/**
 * Get all connections for a business (admin use)
 */
export async function getConnectionsForBusiness(businessId: string): Promise<WhatsAppConnection[]> {
  try {
    const { data, error } = await supabase
      .from('whatsapp_connections')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching connections for business', { businessId, error });
      return [];
    }

    return data || [];
  } catch (error) {
    logger.error('Error in getConnectionsForBusiness', { businessId, error });
    return [];
  }
}

/**
 * Check if a business has an active WhatsApp connection
 */
export async function hasActiveConnection(businessId: string): Promise<boolean> {
  const connection = await getConnectionByBusinessId(businessId);
  return connection !== null && connection.status === 'active';
}

/**
 * Mark a connection as disconnected
 */
export async function markConnectionDisconnected(businessId: string): Promise<void> {
  try {
    await supabase
      .from('whatsapp_connections')
      .update({ status: 'disconnected' })
      .eq('business_id', businessId);

    clearConnectionCache(businessId);
  } catch (error) {
    logger.error('Error marking connection as disconnected', { businessId, error });
  }
}
