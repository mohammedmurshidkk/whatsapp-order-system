import { Router } from 'express';
import * as campaignController from '../controllers/adminCampaignController';
import { authMiddleware } from '../middleware/auth';
import { requireFeature } from '../middleware/featureMiddleware';
import multer from 'multer';

const router: Router = Router();

// Configure multer for memory storage (file upload handling)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (req, file, cb) => {
    // Accept images only
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  }
});

// Apply auth middleware and feature check to all routes
router.use(authMiddleware);
router.use(requireFeature('campaigns'));

// WhatsApp Templates (from Meta)
router.get('/templates', campaignController.getTemplates);
router.get('/templates/:templateName', campaignController.getTemplateByName);

// Campaign management
router.post('/create', campaignController.createCampaign);
router.get('/', campaignController.getCampaigns);
router.get('/:campaignId', campaignController.getCampaign);
router.put('/:campaignId', campaignController.updateCampaign);
router.post('/:campaignId/cancel', campaignController.cancelCampaign);
router.post('/:campaignId/send', campaignController.sendDraftCampaign);

// Media upload
router.post('/upload-image', upload.single('image'), campaignController.uploadCampaignMedia);
router.delete('/delete-image', campaignController.deleteCampaignMedia);

// Send campaign
router.post('/send', campaignController.sendCampaign);

export default router;
