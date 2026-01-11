/**
 * Admin Menu PDF Config Controller
 * Endpoints for managing category-filtered menu PDFs
 */
import { Response } from 'express';
import { AuthRequest, getBusinessId } from '../middleware/auth';
import * as menuPdfConfigService from '../services/menuPdfConfigService';
import { logger } from '../utils/logger';

/**
 * Create a new menu PDF config
 * POST /api/admin/menu/pdf-configs
 */
export async function createPdfConfig(req: AuthRequest, res: Response): Promise<void> {
    try {
        const businessId = getBusinessId(req);
        if (!businessId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { name, categoryIds, name_en, name_local } = req.body;

        if (!name || !categoryIds || !Array.isArray(categoryIds)) {
            res.status(400).json({ error: 'name and categoryIds (array) are required' });
            return;
        }

        const config = await menuPdfConfigService.createMenuPdfConfig(businessId, name, categoryIds, {
            name_en,
            name_local,
        });
        res.status(201).json(config);
    } catch (error) {
        logger.error('Error creating menu PDF config:', error);
        res.status(500).json({ error: 'Failed to create menu PDF config' });
    }
}

/**
 * List all menu PDF configs for the business
 * GET /api/admin/menu/pdf-configs
 */
export async function listPdfConfigs(req: AuthRequest, res: Response): Promise<void> {
    try {
        const businessId = getBusinessId(req);
        if (!businessId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const configs = await menuPdfConfigService.getMenuPdfConfigs(businessId);
        res.json(configs);
    } catch (error) {
        logger.error('Error listing menu PDF configs:', error);
        res.status(500).json({ error: 'Failed to list menu PDF configs' });
    }
}

/**
 * Update a menu PDF config
 * PUT /api/admin/menu/pdf-configs/:id
 */
export async function updatePdfConfig(req: AuthRequest, res: Response): Promise<void> {
    try {
        const { id } = req.params;
        const { name, categoryIds, isActive, name_en, name_local } = req.body;

        const config = await menuPdfConfigService.updateMenuPdfConfig(id, {
            name,
            categoryIds,
            isActive,
            name_en,
            name_local,
        });

        if (!config) {
            res.status(404).json({ error: 'Config not found' });
            return;
        }

        res.json(config);
    } catch (error) {
        logger.error('Error updating menu PDF config:', error);
        res.status(500).json({ error: 'Failed to update menu PDF config' });
    }
}

/**
 * Delete a menu PDF config
 * DELETE /api/admin/menu/pdf-configs/:id
 */
export async function deletePdfConfig(req: AuthRequest, res: Response): Promise<void> {
    try {
        const { id } = req.params;
        await menuPdfConfigService.deleteMenuPdfConfig(id);
        res.status(204).send();
    } catch (error) {
        logger.error('Error deleting menu PDF config:', error);
        res.status(500).json({ error: 'Failed to delete menu PDF config' });
    }
}

/**
 * Sync (generate and upload) PDF for a config
 * POST /api/admin/menu/pdf-configs/:id/sync
 */
export async function syncPdfConfig(req: AuthRequest, res: Response): Promise<void> {
    try {
        const { id } = req.params;

        const pdfUrl = await menuPdfConfigService.syncMenuPdfConfig(id);

        if (!pdfUrl) {
            res.status(404).json({ error: 'Config not found' });
            return;
        }

        res.json({ pdf_url: pdfUrl });
    } catch (error) {
        logger.error('Error syncing menu PDF config:', error);
        res.status(500).json({ error: 'Failed to sync menu PDF config' });
    }
}
