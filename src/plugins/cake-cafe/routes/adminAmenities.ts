import { IRouter, Router } from 'express';
import multer from 'multer';
import {
  listAmenities,
  getAmenity,
  createAmenity,
  updateAmenity,
  deleteAmenity,
  uploadAmenityImage,
  uploadAmenityImageFile,
  toggleAmenityStatus,
} from '../controllers/adminAmenityController';
import { authMiddleware } from '../../../middleware/auth';

const router: IRouter = Router();

// Configure multer for image uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max for amenity images
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

// List all amenities
router.get('/', listAmenities);

// Get single amenity
router.get('/:amenityId', getAmenity);

// Create amenity
router.post('/', createAmenity);

// Update amenity
router.put('/:amenityId', updateAmenity);

// Delete amenity
router.delete('/:amenityId', deleteAmenity);

// Upload amenity image (file upload - multipart/form-data)
router.post('/:amenityId/upload', upload.array('image'), uploadAmenityImageFile);

// Update amenity image URL (JSON body - for external URLs)
router.post('/:amenityId/image', uploadAmenityImage);

// Toggle active status
router.post('/:amenityId/toggle', toggleAmenityStatus);

export default router;
