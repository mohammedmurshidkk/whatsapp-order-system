import { Response } from 'express';
import { AuthRequest, getBusinessId } from '../middleware/auth';
import { aiPromptService } from '../services/aiPromptService';
import { logger } from '../utils/logger';

/**
 * GET /api/ai-prompts/settings
 */
export async function getSettings(req: AuthRequest, res: Response): Promise<void> {
    try {
        const businessId = getBusinessId(req);
        if (!businessId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const settings = await aiPromptService.getSettings(businessId);
        res.status(200).json({ settings });
    } catch (error) {
        logger.error('Controller: Failed to get AI settings', error);
        res.status(500).json({ error: 'Failed to fetch AI settings' });
    }
}

/**
 * PUT /api/ai-prompts/settings
 */
export async function updateSettings(req: AuthRequest, res: Response): Promise<void> {
    try {
        const businessId = getBusinessId(req);
        if (!businessId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { ai_personality, ai_greeting_template_id, ai_farewell_template_id, ai_instructions_enabled } = req.body;

        await aiPromptService.updateSettings(businessId, {
            ai_personality,
            ai_greeting_template_id,
            ai_farewell_template_id,
            ai_instructions_enabled
        });

        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Controller: Failed to update AI settings', error);
        res.status(500).json({ error: 'Failed to update AI settings' });
    }
}

/**
 * GET /api/ai-prompts/templates
 */
export async function listTemplates(req: AuthRequest, res: Response): Promise<void> {
    try {
        const businessId = getBusinessId(req);
        if (!businessId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const templates = await aiPromptService.listTemplates(businessId);
        res.status(200).json({ templates });
    } catch (error) {
        logger.error('Controller: Failed to list templates', error);
        res.status(500).json({ error: 'Failed to fetch templates' });
    }
}

/**
 * POST /api/ai-prompts/templates
 */
export async function createTemplate(req: AuthRequest, res: Response): Promise<void> {
    try {
        const businessId = getBusinessId(req);
        if (!businessId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { name, description, template_content, template_type } = req.body;

        const template = await aiPromptService.createTemplate({
            business_id: businessId,
            name,
            description,
            template_content,
            template_type,
            is_active: true
        });

        res.status(201).json({ template });
    } catch (error) {
        logger.error('Controller: Failed to create template', error);
        res.status(500).json({ error: 'Failed to create template' });
    }
}

/**
 * PUT /api/ai-prompts/templates/:id
 */
export async function updateTemplate(req: AuthRequest, res: Response): Promise<void> {
    try {
        const businessId = getBusinessId(req);
        if (!businessId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { id } = req.params;
        const { name, description, template_content, template_type, is_active } = req.body;

        await aiPromptService.updateTemplate(id, businessId, {
            name,
            description,
            template_content,
            template_type,
            is_active
        });

        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Controller: Failed to update template', error);
        res.status(500).json({ error: 'Failed to update template' });
    }
}

/**
 * DELETE /api/ai-prompts/templates/:id
 */
export async function deleteTemplate(req: AuthRequest, res: Response): Promise<void> {
    try {
        const businessId = getBusinessId(req);
        if (!businessId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { id } = req.params;
        await aiPromptService.deleteTemplate(id, businessId);
        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Controller: Failed to delete template', error);
        res.status(500).json({ error: 'Failed to delete template' });
    }
}
