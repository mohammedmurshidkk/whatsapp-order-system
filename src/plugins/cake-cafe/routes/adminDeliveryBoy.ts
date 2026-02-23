import { IRouter, Router } from 'express';
import {
  listDeliveryBoys,
  getDeliveryBoy,
  createDeliveryBoyHandler,
  updateDeliveryBoyHandler,
  deleteDeliveryBoyHandler,
  listAvailableDeliveryBoys,
  assignDelivery,
} from '../controllers/deliveryBoyController';
import { authMiddleware } from '../../../middleware/auth';
import { requireFeature } from '../../../middleware/featureMiddleware';

const router: IRouter = Router();

// All routes require authentication and delivery_management feature
router.use(authMiddleware);
router.use(requireFeature('delivery_management'));

// CRUD endpoints
router.get('/', listDeliveryBoys);
router.post('/', createDeliveryBoyHandler);
router.get('/available', listAvailableDeliveryBoys);  // Must be before /:id
router.get('/:id', getDeliveryBoy);
router.put('/:id', updateDeliveryBoyHandler);
router.delete('/:id', deleteDeliveryBoyHandler);

// Assign delivery to order
router.post('/assign/:orderId', assignDelivery);

export default router;
