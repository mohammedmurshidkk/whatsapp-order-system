import { IRouter, Router } from 'express';
import multer from 'multer';
import {
  getProfile,
  updateProfile,
  uploadLogo,
  createOutlet,
  updateOutlet,
  deleteOutlet,
  toggleCriticalMessage,
} from '../controllers/adminBusinessController';
import { authMiddleware } from '../middleware/auth';

const router: IRouter = Router();

// Configure multer for logo uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB max for logos
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

// Profile routes
router.get('/profile', getProfile);
router.put('/profile', updateProfile);
router.post('/logo', upload.single('logo'), uploadLogo);

// Critical message quick toggle
router.patch('/critical-message', toggleCriticalMessage);

// Outlet routes
router.post('/outlets', createOutlet);
router.put('/outlets/:outletId', updateOutlet);
router.delete('/outlets/:outletId', deleteOutlet);

export default router;
