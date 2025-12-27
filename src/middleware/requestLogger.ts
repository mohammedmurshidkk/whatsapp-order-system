import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import { logger } from '../utils/logger';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  req.requestId = randomBytes(8).toString('hex');

  // Capture response body
  const originalJson = res.json.bind(res);
  let responseBody: unknown;
  res.json = (body: unknown) => {
    responseBody = body;
    return originalJson(body);
  };

  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData: Record<string, unknown> = {
      rid: req.requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: duration,
    };

    // Log request body for POST/PUT (exclude sensitive fields)
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
      const { password, token, accessToken, ...safeBody } = req.body;
      logData.req = safeBody;
    }

    // Log response for errors
    if (res.statusCode >= 400 && responseBody) {
      logData.res = responseBody;
    }

    if (res.statusCode >= 500) {
      logger.error('Request failed', logData);
    } else if (res.statusCode >= 400) {
      logger.warn('Request error', logData);
    } else {
      logger.info('Request', logData);
    }
  });

  next();
}
