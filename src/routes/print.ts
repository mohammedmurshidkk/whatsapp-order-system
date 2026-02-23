import { IRouter, Router } from 'express';
import {
  getReceiptPreview,
  getPrintData,
  getEditedPreview,
  printOrderReceipt,
  getOutletsWithPrinterStatus,
  updateOutletPrinter,
  getProxyConnectionStatus,
  getOutletProxyStatus,
} from '../controllers/printController';
import { authMiddleware } from '../middleware/auth';
import { requireFeature } from '../middleware/featureMiddleware';

const router: IRouter = Router();

// All routes require authentication and order_print feature
router.use(authMiddleware);
router.use(requireFeature('order_print'));

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

// Get print proxy connection status for all outlets
router.get('/proxy-status', getProxyConnectionStatus);

// Get print proxy connection status for specific outlet
router.get('/proxy-status/:outletId', getOutletProxyStatus);

export default router;
