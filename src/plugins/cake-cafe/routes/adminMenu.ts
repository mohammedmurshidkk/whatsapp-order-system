import { IRouter, Router } from 'express';
import multer from 'multer';
import {
  listMenuItems,
  getMenuItem,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  toggleAvailability,
  uploadItemImage,
  updateItemPrice,
  syncMenuPdf,
  getMenuPdf,
  toggleFeatured,
  updateFeaturedOrder,
} from '../controllers/adminMenuController';
import * as pdfConfigController from '../controllers/adminMenuPdfController';
import { authMiddleware } from '../../../middleware/auth';

const router: IRouter = Router();

// Configure multer for image uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// All routes require authentication
router.use(authMiddleware);

// Menu PDF endpoints (before :itemId routes to avoid conflicts)
router.post('/pdf/sync', syncMenuPdf);  // Generate and upload full menu PDF
router.get('/pdf', getMenuPdf);         // Get full menu PDF URL

// Menu PDF Config endpoints (category-filtered PDFs)
router.post('/pdf-configs', pdfConfigController.createPdfConfig);
router.get('/pdf-configs', pdfConfigController.listPdfConfigs);
router.put('/pdf-configs/:id', pdfConfigController.updatePdfConfig);
router.delete('/pdf-configs/:id', pdfConfigController.deletePdfConfig);
router.post('/pdf-configs/:id/sync', pdfConfigController.syncPdfConfig);

router.get('/', listMenuItems);
router.get('/:itemId', getMenuItem);
router.post('/', createMenuItem);
router.put('/:itemId', updateMenuItem);
router.delete('/:itemId', deleteMenuItem);
router.patch('/:itemId/availability', toggleAvailability);
router.patch('/:itemId/price', updateItemPrice);  // Convenience endpoint for price updates
router.post('/:itemId/image', upload.single('image'), uploadItemImage);

// Featured items
router.patch('/:itemId/featured', toggleFeatured);
router.patch('/featured/order', updateFeaturedOrder);

export default router;
