import { IRouter, Router } from 'express';
import multer from 'multer';
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
  importFlavors,
  importFlavorsFile,
  exportFlavors,
  downloadFlavorTemplate,
} from '../controllers/adminCakePricingController';
import { authMiddleware } from '../../../middleware/auth';
import { requireFeature } from '../../../middleware/featureMiddleware';

const router: IRouter = Router();

// Configure multer for CSV uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' ||
      file.originalname.endsWith('.csv') ||
      file.mimetype === 'application/vnd.ms-excel') {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

// All routes require authentication and cake_pricing feature
router.use(authMiddleware);
router.use(requireFeature('cake_pricing'));

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

// Flavor import/export
router.get('/flavors/template', downloadFlavorTemplate);
router.get('/flavors/export', exportFlavors);
router.post('/flavors/import', importFlavors);
router.post('/flavors/upload', upload.single('flavors'), importFlavorsFile);

// Design elements
router.get('/elements', listDesignElements);
router.post('/elements', createElement);
router.put('/elements/:id', updateElement);
router.delete('/elements/:id', deleteElement);

// Seed standard elements
router.post('/elements/seed', seedElements);

export default router;
