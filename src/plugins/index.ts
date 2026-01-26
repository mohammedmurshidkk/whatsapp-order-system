// src/plugins/index.ts
// Plugin registration and initialization

import { pluginRegistry, getPluginForBusiness } from './registry';
import { CakeCafePlugin } from './cake-cafe';
import { logger } from '../utils/logger';

/**
 * Initialize and register all available plugins
 * Called once at application startup
 */
export function initializePlugins(): void {
  logger.info('Initializing plugins...');

  // Register cake-cafe plugin (default)
  pluginRegistry.register(CakeCafePlugin);

  // Future plugins would be registered here:
  // pluginRegistry.register(FindMyPartnerPlugin);
  // pluginRegistry.register(AppointmentsPlugin);
  // pluginRegistry.register(EcommercePlugin);

  logger.info(`Plugins initialized: ${pluginRegistry.listPluginIds().join(', ')}`);
}

// Export registry and helper
export { pluginRegistry, getPluginForBusiness };

// Export types
export * from './types';

// Export individual plugins for direct access if needed
export { CakeCafePlugin };
