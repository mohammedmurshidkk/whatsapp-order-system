import { Request, Response } from 'express';
import { supabase } from '../config/database';
import { logger } from '../utils/logger';

export async function aggregateItemStats(req: Request, res: Response): Promise<void> {
    try {
        const { date } = req.body;
        const targetDate = date ? new Date(date) : new Date();

        const { error } = await supabase.rpc('aggregate_item_stats', {
            p_date: targetDate.toISOString().split('T')[0],
        });

        if (error) {
            throw error;
        }

        logger.info(`Item stats aggregation triggered for date: ${targetDate.toISOString().split('T')[0]}`);
        res.status(200).json({ success: true, message: 'Item stats aggregation started.' });

    } catch (error) {
        logger.error('Failed to aggregate item stats', error);
        res.status(500).json({ error: 'Failed to aggregate item stats' });
    }
}
