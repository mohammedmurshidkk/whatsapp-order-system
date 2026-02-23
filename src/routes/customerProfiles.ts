import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireFeature } from '../middleware/featureMiddleware';
import * as customerProfileController from '../controllers/customerProfileController';

const router: Router = Router();

// All customer profile routes require authentication and crm_customers feature
router.use(authMiddleware);
router.use(requireFeature('crm_customers'));

router.get('/segments', customerProfileController.getSegments);
router.get('/', customerProfileController.listProfiles);
router.get('/:customerId', customerProfileController.getProfile);
router.put('/:customerId/tags', customerProfileController.updateTags);
router.put('/:customerId/preferences', customerProfileController.updatePreferences);
router.put('/:customerId/notes', customerProfileController.updateNotes);

export default router;
