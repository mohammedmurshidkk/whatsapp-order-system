#!/bin/bash
# Script to update import paths in plugin files

echo "Updating imports in plugin services..."
# Update services to use relative paths for core services
find src/plugins/cake-cafe/services -name "*.ts" -print0 | while IFS= read -r -d '' file; do
    # Convert imports from src/ to relative paths
    sed -i '' "s|from '../types'|from '../../../types'|g" "$file"
    sed -i '' "s|from '../utils/|from '../../../utils/|g" "$file"
    sed -i '' "s|from '../config/|from '../../../config/|g" "$file"
    sed -i '' "s|from '../services/|from '../../../services/|g" "$file"
    sed -i '' "s|from '../db'|from '../../../db'|g" "$file"
    sed -i '' "s|from '../i18n/|from '../../../i18n/|g" "$file"
    
    # Update references to other plugin services (now in same directory)
    sed -i '' "s|from '../../../services/menuService'|from './menuService'|g" "$file"
    sed -i '' "s|from '../../../services/orderService'|from './orderService'|g" "$file"
    sed -i '' "s|from '../../../services/addonService'|from './addonService'|g" "$file"
    sed -i '' "s|from '../../../services/fulfillmentService'|from './fulfillmentService'|g" "$file"
    sed -i '' "s|from '../../../services/cakeQuoteService'|from './cakeQuoteService'|g" "$file"
    sed -i '' "s|from '../../../services/cakePricingService'|from './cakePricingService'|g" "$file"
    sed -i '' "s|from '../../../services/amenityService'|from './amenityService'|g" "$file"
    sed -i '' "s|from '../../../services/deliveryBoyService'|from './deliveryBoyService'|g" "$file"
    sed -i '' "s|from '../../../services/popularItemsService'|from './popularItemsService'|g" "$file"
    sed -i '' "s|from '../../../services/outletService'|from './outletService'|g" "$file"
    sed -i '' "s|from '../../../services/manglishService'|from './manglishService'|g" "$file"
    sed -i '' "s|from '../../../services/pdfService'|from './pdfService'|g" "$file"
    sed -i '' "s|from '../../../services/menuPdfConfigService'|from './menuPdfConfigService'|g" "$file"
    sed -i '' "s|from '../../../services/interventionService'|from './interventionService'|g" "$file"
    sed -i '' "s|from '../../../services/flavorImportService'|from './flavorImportService'|g" "$file"
    sed -i '' "s|from '../../../services/addonImportService'|from './addonImportService'|g" "$file"
    sed -i '' "s|from '../../../services/menuImportService'|from './menuImportService'|g" "$file"
done

echo "Updating imports in plugin controllers..."
find src/plugins/cake-cafe/controllers -name "*.ts" -print0 | while IFS= read -r -d '' file; do
    # Convert imports from src/ to relative paths
    sed -i '' "s|from '../types'|from '../../../types'|g" "$file"
    sed -i '' "s|from '../utils/|from '../../../utils/|g" "$file"
    sed -i '' "s|from '../config/|from '../../../config/|g" "$file"
    sed -i '' "s|from '../services/|from '../services/|g" "$file"
    sed -i '' "s|from '../db'|from '../../../db'|g" "$file"
    sed -i '' "s|from '../middleware/|from '../../../middleware/|g" "$file"
    
    # Update references to plugin services
    sed -i '' "s|from '../services/menuService'|from '../services/menuService'|g" "$file"
    sed -i '' "s|from '../services/orderService'|from '../services/orderService'|g" "$file"
    sed -i '' "s|from '../services/addonService'|from '../services/addonService'|g" "$file"
    sed -i '' "s|from '../services/fulfillmentService'|from '../services/fulfillmentService'|g" "$file"
    sed -i '' "s|from '../services/cakeQuoteService'|from '../services/cakeQuoteService'|g" "$file"
    sed -i '' "s|from '../services/cakePricingService'|from '../services/cakePricingService'|g" "$file"
    sed -i '' "s|from '../services/amenityService'|from '../services/amenityService'|g" "$file"
    sed -i '' "s|from '../services/deliveryBoyService'|from '../services/deliveryBoyService'|g" "$file"
    sed -i '' "s|from '../services/popularItemsService'|from '../services/popularItemsService'|g" "$file"
    sed -i '' "s|from '../services/outletService'|from '../services/outletService'|g" "$file"
    sed -i '' "s|from '../services/manglishService'|from '../services/manglishService'|g" "$file"
    sed -i '' "s|from '../services/pdfService'|from '../services/pdfService'|g" "$file"
    sed -i '' "s|from '../services/menuPdfConfigService'|from '../services/menuPdfConfigService'|g" "$file"
    sed -i '' "s|from '../services/interventionService'|from '../services/interventionService'|g" "$file"
    sed -i '' "s|from '../services/flavorImportService'|from '../services/flavorImportService'|g" "$file"
    sed -i '' "s|from '../services/addonImportService'|from '../services/addonImportService'|g" "$file"
    sed -i '' "s|from '../services/menuImportService'|from '../services/menuImportService'|g" "$file"
    
    # Core services stay at ../../../services/
    sed -i '' "s|from '../services/customerService'|from '../../../services/customerService'|g" "$file"
    sed -i '' "s|from '../services/sessionService'|from '../../../services/sessionService'|g" "$file"
    sed -i '' "s|from '../services/messageService'|from '../../../services/messageService'|g" "$file"
    sed -i '' "s|from '../services/whatsapp|from '../../../services/whatsapp|g" "$file"
    sed -i '' "s|from '../services/mediaService'|from '../../../services/mediaService'|g" "$file"
    sed -i '' "s|from '../services/socketService'|from '../../../services/socketService'|g" "$file"
    sed -i '' "s|from '../services/notificationService'|from '../../../services/notificationService'|g" "$file"
    sed -i '' "s|from '../services/aiService'|from '../../../services/aiService'|g" "$file"
    sed -i '' "s|from '../services/auditService'|from '../../../services/auditService'|g" "$file"
done

echo "Updating imports in plugin routes..."
find src/plugins/cake-cafe/routes -name "*.ts" ! -name "index.ts" -print0 | while IFS= read -r -d '' file; do
    # Convert imports from src/ to relative paths
    sed -i '' "s|from '../controllers/|from '../controllers/|g" "$file"
    sed -i '' "s|from '../middleware/|from '../../../middleware/|g" "$file"
    sed -i '' "s|from '../utils/|from '../../../utils/|g" "$file"
done

echo "Updating imports in plugin handlers..."
find src/plugins/cake-cafe/handlers -name "*.ts" -print0 | while IFS= read -r -d '' file; do
    # Convert imports from src/ to relative paths
    sed -i '' "s|from '../../types'|from '../../../types'|g" "$file"
    sed -i '' "s|from '../../../types'|from '../../../../types'|g" "$file"
    sed -i '' "s|from '../../utils/|from '../../../utils/|g" "$file"
    sed -i '' "s|from '../../../utils/|from '../../../../utils/|g" "$file"
    sed -i '' "s|from '../../services/|from '../../../services/|g" "$file"
    sed -i '' "s|from '../../../services/|from '../../../../services/|g" "$file"
    sed -i '' "s|from '../../config/|from '../../../config/|g" "$file"
    sed -i '' "s|from '../../../config/|from '../../../../config/|g" "$file"
    sed -i '' "s|from '../../i18n/|from '../../../i18n/|g" "$file"
    sed -i '' "s|from '../../../i18n/|from '../../../../i18n/|g" "$file"
    
    # Update plugin service references
    sed -i '' "s|from '../../../../services/menuService'|from '../../services/menuService'|g" "$file"
    sed -i '' "s|from '../../../../services/orderService'|from '../../services/orderService'|g" "$file"
    sed -i '' "s|from '../../../../services/addonService'|from '../../services/addonService'|g" "$file"
    sed -i '' "s|from '../../../../services/fulfillmentService'|from '../../services/fulfillmentService'|g" "$file"
    sed -i '' "s|from '../../../../services/cakeQuoteService'|from '../../services/cakeQuoteService'|g" "$file"
    sed -i '' "s|from '../../../../services/cakePricingService'|from '../../services/cakePricingService'|g" "$file"
    sed -i '' "s|from '../../../../services/amenityService'|from '../../services/amenityService'|g" "$file"
    sed -i '' "s|from '../../../../services/interventionService'|from '../../services/interventionService'|g" "$file"
done

echo "Import updates complete!"

