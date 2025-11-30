import { Router } from 'express';
import multer from 'multer';
import {
  getMenu,
  uploadMenu,
  uploadMenuFile,
  downloadMenu,
  downloadBlankTemplate,
  downloadSampleTemplate,
  validateMenu,
  importFromFile,
} from '../controllers/menuController';

const router = Router();

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

// Download CSV templates
router.get('/template', downloadBlankTemplate);           // Blank template
router.get('/template/blank', downloadBlankTemplate);     // Same as above
router.get('/template/sample', downloadSampleTemplate);   // Sample with data

// Validate CSV without importing
router.post('/validate', validateMenu);

// Get menu for a business
router.get('/:businessId', getMenu);

// Upload/import menu - THREE OPTIONS:

// Option 1: Upload CSV file directly (RECOMMENDED)
// curl -X POST http://localhost:3000/api/menu/{businessId}/upload?replace=true -F "menu=@menu.csv"
router.post('/:businessId/upload', upload.single('menu'), uploadMenuFile);

// Option 2: Send CSV as JSON string
// curl -X POST http://localhost:3000/api/menu/{businessId}/import -H "Content-Type: application/json" -d '{"csv":"...", "replace":true}'
router.post('/:businessId/import', uploadMenu);

// Option 3: Import from server file path (for testing)
// curl -X POST http://localhost:3000/api/menu/{businessId}/import-file -H "Content-Type: application/json" -d '{"filePath":"templates/menu_template.csv", "replace":true}'
router.post('/:businessId/import-file', importFromFile);

// Export menu to CSV
router.get('/:businessId/export', downloadMenu);

export default router;
