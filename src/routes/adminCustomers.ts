import { Router } from 'express';
import * as customerController from '../controllers/adminCustomerController';
import { authMiddleware } from '../middleware/auth';
import { requireFeature } from '../middleware/featureMiddleware';

const router: Router = Router();

// All routes require authentication and crm_customers feature
router.use(authMiddleware);
router.use(requireFeature('crm_customers'));

// List customers
router.get('/', customerController.listCustomers);

// Get customer detail
router.get('/:customerId', customerController.getCustomerDetail);

export default router;
