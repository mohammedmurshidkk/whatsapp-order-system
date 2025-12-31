import { IRouter, Router } from 'express';
import multer from 'multer';
import {
  getSessions,
  getSessionMessages,
  sendReply,
  uploadMedia,
  toggleAiPause,
  markMessagesRead,
} from '../controllers/adminChatController';
import { authMiddleware } from '../middleware/auth';

const router: IRouter = Router();

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max (for documents)
  },
  fileFilter: (_req, file, cb) => {
    // Allowed mime types
    const allowedTypes = [
      // Images
      'image/jpeg',
      'image/png',
      'image/webp',
      // Videos
      'video/mp4',
      'video/3gpp',
      // Audio
      'audio/aac',
      'audio/mp4',
      'audio/mpeg',
      'audio/ogg',
      'audio/webm',
      'audio/amr',
      // Documents
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}`));
    }
  },
});

// All routes require authentication
router.use(authMiddleware);

// Session routes
router.get('/sessions', getSessions);
router.get('/sessions/:sessionId', getSessionMessages);
router.post('/sessions/:sessionId/reply', sendReply);
router.patch('/sessions/:sessionId/ai-pause', toggleAiPause);
router.post('/sessions/:sessionId/mark-read', markMessagesRead);

// Media upload route
router.post('/upload/media', upload.single('file'), uploadMedia);

export default router;
