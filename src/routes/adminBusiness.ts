import { IRouter, Router, Response } from 'express';
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
import { authMiddleware, AuthRequest, getBusinessId } from '../middleware/auth';
import { getBusinessFeatures } from '../services/featureService';
import { logger } from '../utils/logger';

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

// Feature flags route
router.get('/features', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = getBusinessId(req)

    if (!businessId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const features = await getBusinessFeatures(businessId);
    res.json({ features });
  } catch (error) {
    logger.error('Failed to get business features', { error });
    res.status(500).json({ error: 'Failed to load features' });
  }
});

export default router;
