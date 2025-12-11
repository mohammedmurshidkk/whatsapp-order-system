import { Router, type IRouter } from 'express';
import multer from 'multer';
import {
  getMenu,
  getMenuByBusinessId,
  uploadMenu,
  uploadMenuByBusinessId,
  uploadMenuFile,
  uploadMenuFileByBusinessId,
  downloadMenu,
  downloadMenuByBusinessId,
  downloadBlankTemplate,
  downloadSampleTemplate,
  validateMenu,
  importFromFile,
  importFromFileByBusinessId,
  uploadAddons,
  uploadAddonsByBusinessId,
  downloadAddonsTemplate,
} from '../controllers/menuController';
import { authMiddleware } from '../middleware/auth';

const router: IRouter = Router();

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (_req, file, cb) => {
    // Accept only CSV files
    if (file.mimetype === 'text/csv' ||
        file.originalname.endsWith('.csv') ||
        file.mimetype === 'application/vnd.ms-excel') {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

// ============================================
// PUBLIC ROUTES (no auth required)
// Templates and validation
// ============================================

// Download CSV templates (public - anyone can download templates)
router.get('/template', downloadBlankTemplate);
router.get('/template/blank', downloadBlankTemplate);
router.get('/template/sample', downloadSampleTemplate);
router.get('/addons/template', downloadAddonsTemplate);

// Validate CSV without importing (public)
router.post('/validate', validateMenu);

// ============================================
// SUPER ADMIN ROUTES (no auth, requires businessId)
// For initial setup via upload.html
// ============================================

// Get menu by business ID
router.get('/business/:businessId', getMenuByBusinessId);

// Upload menu by business ID
router.post('/business/:businessId/upload', upload.single('menu'), uploadMenuFileByBusinessId);
router.post('/business/:businessId/import', uploadMenuByBusinessId);
router.post('/business/:businessId/import-file', importFromFileByBusinessId);

// Export menu by business ID
router.get('/business/:businessId/export', downloadMenuByBusinessId);

// Add-ons import by business ID
router.post('/business/:businessId/addons/import', uploadAddonsByBusinessId);

// ============================================
// PROTECTED ROUTES (require JWT authentication)
// For business admin panel
// ============================================

// Apply auth middleware to all routes below
router.use(authMiddleware);

// Get menu for authenticated business
router.get('/', getMenu);

// Upload/import menu
router.post('/upload', upload.single('menu'), uploadMenuFile);
router.post('/import', uploadMenu);
router.post('/import-file', importFromFile);

// Export menu to CSV
router.get('/export', downloadMenu);

// Add-ons import
router.post('/addons/import', uploadAddons);

export default router;
