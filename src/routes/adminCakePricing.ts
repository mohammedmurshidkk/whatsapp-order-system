import { IRouter, Router } from 'express';
import {
  listWeightPricings,
  createWeight,
  updateWeight,
  deleteWeight,
  listFlavorPricings,
  createFlavor,
  updateFlavor,
  deleteFlavor,
  listDesignElements,
  createElement,
  updateElement,
  deleteElement,
  seedElements,
  getFullConfig,
  updateConfig,
} from '../controllers/adminCakePricingController';
import { authMiddleware } from '../middleware/auth';

const router: IRouter = Router();

// All routes require authentication
router.use(authMiddleware);

// Get/Update full pricing config
router.get('/config', getFullConfig);
router.put('/config', updateConfig);

// Weight pricing
router.get('/weights', listWeightPricings);
router.post('/weights', createWeight);
router.put('/weights/:id', updateWeight);
router.delete('/weights/:id', deleteWeight);

// Flavor pricing
router.get('/flavors', listFlavorPricings);
router.post('/flavors', createFlavor);
router.put('/flavors/:id', updateFlavor);
router.delete('/flavors/:id', deleteFlavor);

// Design elements
router.get('/elements', listDesignElements);
router.post('/elements', createElement);
router.put('/elements/:id', updateElement);
router.delete('/elements/:id', deleteElement);

// Seed standard elements
router.post('/elements/seed', seedElements);

export default router;
