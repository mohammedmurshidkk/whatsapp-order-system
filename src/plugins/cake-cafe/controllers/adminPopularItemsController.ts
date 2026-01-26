import { Response } from 'express';
import { AuthRequest, getBusinessId } from '../../../middleware/auth';
import { getTopSellingItems, getFeaturedItems } from '../services/popularItemsService';
import { logger } from '../../../utils/logger';

type PopularityPeriod = 'daily' | 'weekly' | 'monthly' | 'all_time';

export async function getPopularItems(req: AuthRequest, res: Response): Promise<void> {
    try {
        const businessId = getBusinessId(req);
        if (!businessId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const period = (req.query.period as PopularityPeriod) || 'weekly';
        const limit = parseInt(req.query.limit as string, 10) || 10;

        if (!['daily', 'weekly', 'monthly', 'all_time'].includes(period)) {
            res.status(400).json({ error: 'Invalid period specified' });
            return;
        }

        const [topItems, featuredItems] = await Promise.all([
            getTopSellingItems(businessId, period, limit),
            getFeaturedItems(businessId, limit),
        ]);

        // Normalize featured items to match top items structure
        const normalizedFeatured = featuredItems.map(item => ({
            menu_item_id: item.id,
            item_name: item.name,
            order_count: 0,
            quantity_sold: 0,
            revenue: 0,
            is_featured: true,
            featured_order: item.featured_order || 0,
            menu_item: {
                id: item.id,
                name: item.name,
                description: item.description,
                base_price: item.base_price,
                sizes: item.sizes,
                image_url: item.image_url,
            },
        }));

        // Merge: featured items first, then top items (avoiding duplicates)
        const featuredIds = new Set(featuredItems.map(f => f.id));
        const mergedItems = [
            ...normalizedFeatured,
            ...topItems.filter(item => !featuredIds.has(item.menu_item_id)).map(item => ({
                ...item,
                is_featured: false,
            })),
        ];

        res.status(200).json({
            items: mergedItems,
            stats: {
                featured_count: featuredItems.length,
                top_selling_count: topItems.length,
            }
        });
    } catch (error) {
        logger.error('Failed to get popular items', error);
        res.status(500).json({ error: 'Failed to fetch popular items' });
    }
}
