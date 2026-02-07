import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import * as customerProfileController from '../controllers/customerProfileController';

const router: Router = Router();

// All customer profile routes require authentication
router.use(authMiddleware);

router.get('/segments', customerProfileController.getSegments);
router.get('/', customerProfileController.listProfiles);
router.get('/:customerId', customerProfileController.getProfile);
router.put('/:customerId/tags', customerProfileController.updateTags);
router.put('/:customerId/preferences', customerProfileController.updatePreferences);
router.put('/:customerId/notes', customerProfileController.updateNotes);

export default router;
