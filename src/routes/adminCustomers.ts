import { Router } from 'express';
import * as customerController from '../controllers/adminCustomerController';
import { authMiddleware } from '../middleware/auth';

const router: Router = Router();

// All routes require authentication
router.use(authMiddleware);

// List customers
router.get('/', customerController.listCustomers);

// Get customer detail
router.get('/:customerId', customerController.getCustomerDetail);

export default router;
