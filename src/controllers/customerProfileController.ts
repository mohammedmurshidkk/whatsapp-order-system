import { Response } from 'express';
import { AuthRequest, getBusinessId } from '../middleware/auth';
import { customerProfileService } from '../services/customerProfileService';
import { logger } from '../utils/logger';
import { CustomerSegment } from '../types';

/**
 * GET /api/customer-profiles/segments
 */
export async function getSegments(req: AuthRequest, res: Response): Promise<void> {
    try {
        const businessId = getBusinessId(req);
        if (!businessId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const segments = await customerProfileService.getSegmentCounts(businessId);
        res.status(200).json({ segments });
    } catch (error) {
        logger.error('Controller: Failed to get segment counts', error);
        res.status(500).json({ error: 'Failed to fetch segment counts' });
    }
}

/**
 * GET /api/customer-profiles
 */
export async function listProfiles(req: AuthRequest, res: Response): Promise<void> {
    try {
        const businessId = getBusinessId(req);
        if (!businessId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { segment, tags, search, limit, offset } = req.query;

        const result = await customerProfileService.listProfiles({
            businessId,
            segment: segment as CustomerSegment,
            tags: tags ? (Array.isArray(tags) ? tags as string[] : [String(tags)]) : undefined,
            search: search ? String(search) : undefined,
            limit: limit ? parseInt(String(limit), 10) : 20,
            offset: offset ? parseInt(String(offset), 10) : 0
        });

        res.status(200).json(result);
    } catch (error) {
        logger.error('Controller: Failed to list customer profiles', error);
        res.status(500).json({ error: 'Failed to fetch customer profiles' });
    }
}

/**
 * GET /api/customer-profiles/:customerId
 */
export async function getProfile(req: AuthRequest, res: Response): Promise<void> {
    try {
        const businessId = getBusinessId(req);
        if (!businessId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { customerId } = req.params;
        const profile = await customerProfileService.getProfile(businessId, customerId);

        if (!profile) {
            res.status(404).json({ error: 'Customer profile not found' });
            return;
        }

        res.status(200).json({ profile });
    } catch (error) {
        logger.error('Controller: Failed to get customer profile', error);
        res.status(500).json({ error: 'Failed to fetch customer profile' });
    }
}

/**
 * PUT /api/customer-profiles/:customerId/tags
 */
export async function updateTags(req: AuthRequest, res: Response): Promise<void> {
    try {
        const businessId = getBusinessId(req);
        if (!businessId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { customerId } = req.params;
        const { tags } = req.body;

        if (!Array.isArray(tags)) {
            res.status(400).json({ error: 'tags must be an array' });
            return;
        }

        await customerProfileService.updateTags(businessId, customerId, tags);
        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Controller: Failed to update customer tags', error);
        res.status(500).json({ error: 'Failed to update tags' });
    }
}

/**
 * PUT /api/customer-profiles/:customerId/preferences
 */
export async function updatePreferences(req: AuthRequest, res: Response): Promise<void> {
    try {
        const businessId = getBusinessId(req);
        if (!businessId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { customerId } = req.params;
        const { preferences } = req.body;

        await customerProfileService.updatePreferences(businessId, customerId, preferences);
        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Controller: Failed to update customer preferences', error);
        res.status(500).json({ error: 'Failed to update preferences' });
    }
}

/**
 * PUT /api/customer-profiles/:customerId/notes
 */
export async function updateNotes(req: AuthRequest, res: Response): Promise<void> {
    try {
        const businessId = getBusinessId(req);
        if (!businessId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { customerId } = req.params;
        const { notes } = req.body;

        await customerProfileService.updateNotes(businessId, customerId, notes);
        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Controller: Failed to update customer notes', error);
        res.status(500).json({ error: 'Failed to update notes' });
    }
}
