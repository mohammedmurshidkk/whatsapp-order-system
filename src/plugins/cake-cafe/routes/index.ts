// src/plugins/cake-cafe/routes/index.ts
// Route registration for Cake & Cafe Plugin

import { Express } from 'express';
import menuRoutes from './menu';
import adminMenuRoutes from './adminMenu';
import adminCategoryRoutes from './adminCategories';
import adminAddonRoutes from './adminAddons';
import adminOrderRoutes from './adminOrders';
import adminCakePricingRoutes from './adminCakePricing';
import adminCakeQuotesRoutes from './adminCakeQuotes';
import adminAmenityRoutes from './adminAmenities';
import adminDeliveryBoyRoutes from './adminDeliveryBoy';
import adminPopularItemsRoutes from './adminPopularItems';
import adminInterventionRoutes from './adminInterventions';

/**
 * Register all routes for the Cake & Cafe plugin
 * This function is called from the main app.ts
 */
export function registerCakeCafeRoutes(app: Express): void {
    // Public routes
    app.use('/api/menu', menuRoutes);

    // Admin routes
    app.use('/api/admin/menu', adminMenuRoutes);
    app.use('/api/categories', adminCategoryRoutes);
    app.use('/api/addons', adminAddonRoutes);
    app.use('/api/orders', adminOrderRoutes);
    app.use('/api/admin/cake-pricing', adminCakePricingRoutes);
    app.use('/api/admin/cake-quotes', adminCakeQuotesRoutes);
    app.use('/api/admin/amenities', adminAmenityRoutes);
    app.use('/api/admin/interventions', adminInterventionRoutes);
    app.use('/api/admin/delivery-boys', adminDeliveryBoyRoutes);
    app.use('/api/admin/popular-items', adminPopularItemsRoutes);
}
