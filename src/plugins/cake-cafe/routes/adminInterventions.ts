import { Router } from 'express';
import * as interventionController from '../controllers/adminInterventionController';
import { authMiddleware } from '../../../middleware/auth';
import { requireFeature } from '../../../middleware/featureMiddleware';

const router: Router = Router();

// Apply auth middleware and interventions feature check to all routes
router.use(authMiddleware);
router.use(requireFeature('interventions'));

// List pending interventions
router.get('/', interventionController.getPendingInterventions);

// Get specific intervention
router.get('/:id', interventionController.getInterventionById);

// Get interventions for a session
router.get('/session/:sessionId', interventionController.getInterventionsBySession);

// Claim intervention for review
router.put('/:id/claim', interventionController.claimIntervention);

// Resolve intervention (approve/reject/price)
router.put('/:id/resolve', interventionController.resolveIntervention);

// Cancel intervention
router.delete('/:id', interventionController.cancelIntervention);

export default router;
