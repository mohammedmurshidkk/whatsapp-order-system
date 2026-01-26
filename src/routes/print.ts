import { IRouter, Router } from 'express';
import {
  getReceiptPreview,
  getPrintData,
  getEditedPreview,
  printOrderReceipt,
  getOutletsWithPrinterStatus,
  updateOutletPrinter,
} from '../controllers/printController';
import { authMiddleware } from '../middleware/auth';

const router: IRouter = Router();

// All routes require authentication
router.use(authMiddleware);

// Get editable JSON data for print modal
router.get('/data/:orderId', getPrintData);

// Get HTML preview of receipt (for testing - original data)
router.get('/preview/:orderId', getReceiptPreview);

// Get HTML preview from edited data (for modal preview)
router.post('/preview', getEditedPreview);

// Print order to thermal printer (with optional edited data)
router.post('/:orderId', printOrderReceipt);

// Get outlets with printer status
router.get('/outlets', getOutletsWithPrinterStatus);

// Update printer IP for outlet
router.patch('/outlets/:outletId/printer', updateOutletPrinter);

export default router;
