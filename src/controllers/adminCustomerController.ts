import { Response } from 'express';
import { supabase } from '../config/database';
import { AuthRequest, getBusinessId } from '../middleware/auth';
import { logger } from '../utils/logger';

/**
 * List all customers for a business with pagination and search
 */
export async function listCustomers(req: AuthRequest, res: Response): Promise<void> {
    try {
        const businessId = getBusinessId(req);
        if (!businessId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { search, page = '1', limit = '20' } = req.query;
        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);
        const offset = (pageNum - 1) * limitNum;

        let query = supabase
            .from('customers')
            .select('*', { count: 'exact' })
            .eq('business_id', businessId)
            .order('created_at', { ascending: false });

        if (search) {
            const searchTerm = `%${search}%`;
            query = query.or(`name.ilike.${searchTerm},phone.ilike.${searchTerm}`);
        }

        query = query.range(offset, offset + limitNum - 1);

        const { data: customers, error, count } = await query;

        if (error) throw error;

        res.status(200).json({
            customers: customers || [],
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: count || 0,
            },
        });
    } catch (error) {
        logger.error('Failed to list customers', error);
        res.status(500).json({ error: 'Failed to fetch customers' });
    }
}

/**
 * Get customer details including order history
 */
export async function getCustomerDetail(req: AuthRequest, res: Response): Promise<void> {
    try {
        const businessId = getBusinessId(req);
        if (!businessId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { customerId } = req.params;

        // Get customer info
        const { data: customer, error: customerError } = await supabase
            .from('customers')
            .select('*')
            .eq('id', customerId)
            .eq('business_id', businessId)
            .single();

        if (customerError || !customer) {
            res.status(404).json({ error: 'Customer not found' });
            return;
        }

        // Get customer's order history
        const { data: orders, error: ordersError } = await supabase
            .from('orders')
            .select('id, order_number, total_amount, status, created_at, fulfillment_type')
            .eq('customer_id', customerId)
            .order('created_at', { ascending: false });

        if (ordersError) throw ordersError;

        res.status(200).json({
            customer,
            orders: orders || [],
        });
    } catch (error) {
        logger.error('Failed to get customer detail', error);
        res.status(500).json({ error: 'Failed to fetch customer details' });
    }
}
