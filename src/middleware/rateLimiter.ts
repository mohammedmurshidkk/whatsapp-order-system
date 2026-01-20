/**
 * Rate Limiter Middleware
 * Protects against spam and abuse by limiting requests per identifier (phone number, IP)
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitConfig {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Max requests per window
  message?: string;      // Custom error message
}

// In-memory store for rate limiting (resets on server restart - acceptable for rate limiting)
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries periodically (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.debug(`Rate limiter cleanup: removed ${cleaned} expired entries`);
  }
}, 5 * 60 * 1000);

/**
 * Check if identifier is rate limited
 */
function isRateLimited(identifier: string, config: RateLimitConfig): { limited: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(identifier);

  if (!entry || entry.resetAt < now) {
    // New window
    rateLimitStore.set(identifier, {
      count: 1,
      resetAt: now + config.windowMs,
    });
    return { limited: false, remaining: config.maxRequests - 1, resetAt: now + config.windowMs };
  }

  // Increment count
  entry.count++;
  rateLimitStore.set(identifier, entry);

  if (entry.count > config.maxRequests) {
    return { limited: true, remaining: 0, resetAt: entry.resetAt };
  }

  return { limited: false, remaining: config.maxRequests - entry.count, resetAt: entry.resetAt };
}

/**
 * Rate limiter for WhatsApp webhook messages
 * Limits by phone number to prevent spam from single users
 */
export function webhookRateLimiter(config: RateLimitConfig = { windowMs: 60000, maxRequests: 30 }) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Extract phone number from WhatsApp webhook payload
    let phoneNumber: string | null = null;

    try {
      const entry = req.body?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const message = value?.messages?.[0];
      phoneNumber = message?.from || null;
    } catch {
      // If we can't extract phone, fall through without rate limiting
    }

    if (!phoneNumber) {
      // Can't identify sender, allow request but log
      return next();
    }

    const identifier = `webhook:${phoneNumber}`;
    const result = isRateLimited(identifier, config);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', config.maxRequests);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));

    if (result.limited) {
      logger.warn('Rate limit exceeded for WhatsApp webhook', {
        phoneNumber,
        resetAt: new Date(result.resetAt).toISOString(),
      });

      // Return 200 to WhatsApp (they expect 200), but don't process
      // This prevents WhatsApp from retrying
      return res.status(200).json({
        status: 'rate_limited',
        message: config.message || 'Too many messages. Please wait a moment.',
      });
    }

    next();
  };
}

/**
 * Rate limiter for API endpoints
 * Limits by IP address
 */
export function apiRateLimiter(config: RateLimitConfig = { windowMs: 60000, maxRequests: 100 }) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Get IP address (consider proxy headers)
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const identifier = `api:${ip}`;

    const result = isRateLimited(identifier, config);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', config.maxRequests);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));

    if (result.limited) {
      logger.warn('API rate limit exceeded', {
        ip,
        path: req.path,
        resetAt: new Date(result.resetAt).toISOString(),
      });

      return res.status(429).json({
        error: 'Too many requests',
        message: config.message || 'Rate limit exceeded. Please try again later.',
        retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
      });
    }

    next();
  };
}

/**
 * Rate limiter for login attempts
 * Stricter limits to prevent brute force
 */
export function loginRateLimiter(config: RateLimitConfig = { windowMs: 900000, maxRequests: 5 }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const email = req.body?.email?.toLowerCase() || 'unknown';

    // Rate limit by both IP and email to prevent distributed attacks
    const ipIdentifier = `login:ip:${ip}`;
    const emailIdentifier = `login:email:${email}`;

    const ipResult = isRateLimited(ipIdentifier, config);
    const emailResult = isRateLimited(emailIdentifier, config);

    const isLimited = ipResult.limited || emailResult.limited;
    const remaining = Math.min(ipResult.remaining, emailResult.remaining);
    const resetAt = Math.max(ipResult.resetAt, emailResult.resetAt);

    res.setHeader('X-RateLimit-Limit', config.maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(resetAt / 1000));

    if (isLimited) {
      logger.warn('Login rate limit exceeded', {
        ip,
        email,
        resetAt: new Date(resetAt).toISOString(),
      });

      return res.status(429).json({
        error: 'Too many login attempts',
        message: 'Please wait before trying again.',
        retryAfter: Math.ceil((resetAt - Date.now()) / 1000),
      });
    }

    next();
  };
}

/**
 * Get current rate limit stats (for monitoring)
 */
export function getRateLimitStats(): { totalEntries: number; entries: Array<{ identifier: string; count: number; resetAt: string }> } {
  const entries: Array<{ identifier: string; count: number; resetAt: string }> = [];

  for (const [identifier, entry] of rateLimitStore.entries()) {
    entries.push({
      identifier,
      count: entry.count,
      resetAt: new Date(entry.resetAt).toISOString(),
    });
  }

  return {
    totalEntries: rateLimitStore.size,
    entries: entries.slice(0, 100), // Limit to 100 for API response
  };
}
