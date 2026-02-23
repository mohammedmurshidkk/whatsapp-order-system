/**
 * Feature Middleware
 * Checks if a feature is enabled for the business before allowing API access
 */

import { Response, NextFunction } from 'express';
import { AuthRequest, getBusinessId } from './auth';
import { isFeatureEnabled } from '../services/featureService';
import { logger } from '../utils/logger';

/**
 * Creates a middleware that checks if a specific feature is enabled
 * @param featureKey The feature key to check
 * @returns Express middleware function
 */
export const requireFeature = (featureKey: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const businessId = getBusinessId(req);

      if (!businessId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const enabled = await isFeatureEnabled(businessId, featureKey);

      if (!enabled) {
        logger.warn('Feature access denied', {
          featureKey,
          businessId,
          path: req.path,
        });
        return res.status(403).json({
          error: 'Feature not enabled',
          feature: featureKey,
          message: `The ${featureKey} feature is not enabled for your business.`,
        });
      }

      next();
    } catch (error) {
      logger.error('Feature check failed', { error, featureKey });
      // Allow access on error to prevent blocking legitimate requests
      next();
    }
  };
};
