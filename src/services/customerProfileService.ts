import { supabase } from '../config/database';
import { logger } from '../utils/logger';
import { CustomerProfile, CustomerSegment } from '../types';

export class CustomerProfileService {
    /**
     * Get all customer profiles for a business with filtering
     */
    async listProfiles(params: {
        businessId: string;
        segment?: CustomerSegment;
        tags?: string[];
        search?: string;
        limit?: number;
        offset?: number;
    }): Promise<{ profiles: CustomerProfile[]; total: number }> {
        try {
            let query = supabase
                .from('customer_profiles')
                .select('*, customer:customers(phone, name)', { count: 'exact' })
                .eq('business_id', params.businessId);

            if (params.segment) {
                query = query.eq('segment', params.segment);
            }

            if (params.tags && params.tags.length > 0) {
                query = query.contains('tags', params.tags);
            }

            // Profile search usually joins with customer table
            // Supabase search on joined table is best done via RPC or complex filter
            // For now, simple segment/tag filtering is primary

            const { data, count, error } = await query
                .order('total_spent', { ascending: false })
                .range(params.offset || 0, (params.offset || 0) + (params.limit || 20) - 1);

            if (error) throw error;

            return {
                profiles: data as any[],
                total: count || 0
            };
        } catch (error) {
            logger.error('Failed to list customer profiles', { error, params });
            throw error;
        }
    }

    /**
     * Get a single customer profile
     */
    async getProfile(businessId: string, customerId: string): Promise<CustomerProfile | null> {
        try {
            const { data, error } = await supabase
                .from('customer_profiles')
                .select('*, customer:customers(*)')
                .eq('business_id', businessId)
                .eq('customer_id', customerId)
                .single();

            if (error && error.code !== 'PGRST116') throw error;
            return data as any;
        } catch (error) {
            logger.error('Failed to get customer profile', { error, businessId, customerId });
            throw error;
        }
    }

    /**
     * Update profile tags
     */
    async updateTags(businessId: string, customerId: string, tags: string[]): Promise<void> {
        try {
            const { error } = await supabase
                .from('customer_profiles')
                .update({ tags, updated_at: new Date().toISOString() })
                .eq('business_id', businessId)
                .eq('customer_id', customerId);

            if (error) throw error;
        } catch (error) {
            logger.error('Failed to update customer tags', { error, businessId, customerId, tags });
            throw error;
        }
    }

    /**
     * Update customer preferences
     */
    async updatePreferences(businessId: string, customerId: string, preferences: any): Promise<void> {
        try {
            const { error } = await supabase
                .from('customer_profiles')
                .update({ preferences, updated_at: new Date().toISOString() })
                .eq('business_id', businessId)
                .eq('customer_id', customerId);

            if (error) throw error;
        } catch (error) {
            logger.error('Failed to update customer preferences', { error, businessId, customerId });
            throw error;
        }
    }

    /**
     * Add note to profile
     */
    async updateNotes(businessId: string, customerId: string, notes: string): Promise<void> {
        try {
            const { error } = await supabase
                .from('customer_profiles')
                .update({ notes, updated_at: new Date().toISOString() })
                .eq('business_id', businessId)
                .eq('customer_id', customerId);

            if (error) throw error;
        } catch (error) {
            logger.error('Failed to update customer notes', { error, businessId, customerId });
            throw error;
        }
    }

    /**
     * Get segment counts for a business
     */
    async getSegmentCounts(businessId: string): Promise<Record<string, number>> {
        try {
            const { data, error } = await supabase
                .from('customer_profiles')
                .select('segment')
                .eq('business_id', businessId);

            if (error) throw error;

            const counts: Record<string, number> = {
                all: data.length,
                new: 0,
                returning: 0,
                vip: 0,
                at_risk: 0,
                churned: 0
            };

            data.forEach(p => {
                if (counts[p.segment] !== undefined) {
                    counts[p.segment]++;
                }
            });

            return counts;
        } catch (error) {
            logger.error('Failed to get segment counts', { error, businessId });
            throw error;
        }
    }

    /**
     * AI Preference Learning (called after order completion)
     */
    async learnCustomerPreferences(businessId: string, customerId: string, orderId: string): Promise<void> {
        try {
            // 1. Get current preferences
            const profile = await this.getProfile(businessId, customerId);
            const currentPreferences = profile?.preferences || {};

            // 2. Get the order items
            const { data: order, error } = await supabase
                .from('orders')
                .select('items')
                .eq('id', orderId)
                .single();

            if (error || !order) return;

            // 3. Extract items and update "favorite_items"
            const items = (order.items as any[]) || [];
            const favorites = currentPreferences.favorite_items || {};

            items.forEach(item => {
                const itemName = item.name;
                favorites[itemName] = (favorites[itemName] || 0) + 1;
            });

            // 4. Update preferred fulfillment type
            const { data: recentOrders } = await supabase
                .from('orders')
                .select('fulfillment_type')
                .eq('customer_id', customerId)
                .eq('business_id', businessId)
                .eq('status', 'completed')
                .order('created_at', { ascending: false })
                .limit(5);

            if (recentOrders && recentOrders.length > 0) {
                const types = recentOrders.map(o => o.fulfillment_type);
                const deliveryCount = types.filter(t => t === 'delivery').length;
                currentPreferences.preferred_fulfillment = deliveryCount >= 3 ? 'delivery' : 'takeaway';
            }

            currentPreferences.favorite_items = favorites;

            // 5. Save preferences
            await this.updatePreferences(businessId, customerId, currentPreferences);
            logger.info(`Learned preferences for customer ${customerId} from order ${orderId}`);
        } catch (error) {
            logger.warn('Failed to learn customer preferences', { error, businessId, customerId, orderId });
        }
    }
}

export const customerProfileService = new CustomerProfileService();
