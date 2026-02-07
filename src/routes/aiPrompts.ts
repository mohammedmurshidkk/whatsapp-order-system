import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import * as aiPromptController from '../controllers/aiPromptController';

const router: Router = Router();

// All AI prompt routes require authentication
router.use(authMiddleware);

router.get('/settings', aiPromptController.getSettings);
router.put('/settings', aiPromptController.updateSettings);
router.get('/templates', aiPromptController.listTemplates);
router.post('/templates', aiPromptController.createTemplate);
router.put('/templates/:id', aiPromptController.updateTemplate);
router.delete('/templates/:id', aiPromptController.deleteTemplate);

export default router;
